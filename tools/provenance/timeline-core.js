// Kärnan i Härkomst: gör om rollqueryernas rader till en händelselista i UTC, avgör vilken
// sorts fil det är, bedömer de tre faktorerna (skapandetid, app igång, kamera igång) som
// förenligt, inte förenligt eller saknas, och skriver förklaringens meningar. Ingen DOM, ingen SQL.
// Bedömningen är hypotesstöd: "förenligt med", aldrig en slutsats. Testas i Node.
(function (root) {
    'use strict';

    var MINUTE = 60000;
    var TOLERANCE_MS = 5000;        // ett intervall "täcker" T med den här marginalen
    var POWERLOG_TOL_MS = 1500;     // PowerLogs kamera: rättad tid stämmer med bildbiblioteket på ungefär en sekund
    var SAME_TIME_MS = 60000;       // Skapad och Tillagd räknas som samtidiga inom en minut
    var LATE_MS = 3600000;          // Tillagd mer än en timme efter Skapad: kom till telefonen senare
    var MERGE_GAP_MS = 2000;        // täta händelser från samma app slås ihop i förklaringen

    var IOS_CAMERA = 'com.apple.camera';
    var IOS_SPRINGBOARD = 'com.apple.springboard';
    var IOS_SHARINGD = 'com.apple.sharingd';
    var IOS_PHOTOS = 'com.apple.mobileslideshow';
    var SNAPCHAT = 'com.toyopagroup.picaboo';
    var SNAPCHAT_ANDROID = 'com.snapchat.android';
    var SIGNAL_ANDROID = 'org.thoughtcrime.securesms';
    var SIGNAL_IOS = 'org.whispersystems.signal';
    var WHATSAPP = 'net.whatsapp.WhatsApp';
    var WHATSAPP_BUSINESS = 'net.whatsapp.WhatsAppSMB';
    var TELEGRAM = 'ph.telegra.Telegraph';

    function isSnapchatApp(id) { return id === SNAPCHAT || id === SNAPCHAT_ANDROID; }

    // Loggen för app, skärm och lås: knowledgeC på iOS; på Android usagestats när den finns i
    // extraktionen, annars Wellbeing. Etiketten står i faktorernas texter, nyckeln i täckningen.
    function logInfo(input) {
        if (input.platform !== 'Android') return { label: 'knowledgeC', key: '/app/usage', screenKey: '/display/isBacklit' };
        var stream = input.androidLog || ((input.appIntervals || [])[0] || (input.screen || [])[0] || {}).stream || 'wellbeing';
        return stream === 'usagestats' ? { label: 'usagestats', key: 'usagestats', screenKey: 'usagestats' } : { label: 'Wellbeing', key: 'wellbeing', screenKey: 'wellbeing' };
    }

    // Läget för en faktor eller en rad: om det är förenligt med hypotesen i sammanvägningen
    // (att telefonen skapade filen på det sätt typen säger), inte förenligt, eller inte går att bedöma.
    var STATE_LABEL = { support: 'Förenligt', contradiction: 'Inte förenligt', missing: 'Saknas', info: 'Upplysning', na: 'Inte tillämplig' };

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    // Fast förskjutning i minuter. Räcker inom ett fönster på några timmar; UI:t kan skicka
    // en egen formatterare med riktig zon.
    function formatWithOffset(ms, offsetMinutes) {
        var d = new Date(ms + (offsetMinutes || 0) * MINUTE);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
            pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    }

    function formatUtc(ms) { return formatWithOffset(ms, 0) + ' UTC'; }

    function duration(ms) {
        var s = Math.round(Math.abs(ms) / 1000);
        if (s < 60) return s + ' s';
        if (s < 3600) return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
        if (s < 86400) return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
        return Math.floor(s / 86400) + ' dygn ' + Math.floor((s % 86400) / 3600) + ' h';
    }

    function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

    // Intervallet kan vara en rad ({ startMs, endMs }) eller en händelse ({ ms, endMs }).
    function covers(iv, ms, tol) {
        tol = tol == null ? TOLERANCE_MS : tol;
        var start = iv.startMs != null ? iv.startMs : iv.ms;
        return start != null && iv.endMs != null && start - tol <= ms && iv.endMs + tol >= ms;
    }

    function isCameraApp(app, cameraApps) {
        if (!app) return false;
        if (app === IOS_CAMERA) return true;
        return (cameraApps || []).indexOf(app) >= 0;
    }

    // Appnamn i klartext via App-ID-katalogen, annars id:t.
    function appName(id, names) {
        if (!id) return 'okänd app';
        var n = names ? names(id) : null;
        return n || id;
    }

    // ---------- Typ av fil ----------

    // Hur en fil i Snapchats cache kom till, ur registerraden: inspelad, skickad, mottagen.
    function snapOrigin(sc) {
        if (!sc) return null;
        if (Number(sc.context) === 34) return 'recorded';
        var ext = sc.external || {};
        if (ext.kind === 'sent') return 'sent';
        if ((ext.kind === 'message' || ext.kind === 'chat') && sc.own != null) return sc.own ? 'sent' : 'received';
        if (ext.kind === 'message') return 'received';
        return 'unknown';
    }

    // file: raden ur Photos.sqlite eller MediaStore med fältkartans namn, eller en fil i Snapchats
    // cache med file.snapchatCache = { path, key, context, label, known, external, own, who, recordingCopy }.
    function classify(file, platform, opts) {
        opts = opts || {};
        var reasons = [];
        var flags = [];
        var type = 'unknown';
        var transfer = null;
        var importer = file.importer || '';
        var importedBy = file.importedBy == null ? null : Number(file.importedBy);
        var rel = lower(file.relativePath);
        var name = lower(file.filename);
        var sc = file.snapchatCache || null;
        // En chattapps egen fil (WhatsApps Message/Media/ på iOS), kopplad till sitt meddelande.
        var chat = !sc && file.chatMedia ? file.chatMedia : null;
        if (chat) {
            type = 'saved';
            importer = chat.app;
            reasons.push('filen är ' + chat.appName + 's egen (' + chat.path + ')');
            reasons.push('meddelande ' + chat.messageId + ', ' + (chat.direction === 'in' ? 'mottaget från ' + chat.who : 'skickat till ' + chat.who) + ' (' + chat.source + ')');
        } else if (sc) {
            type = 'snapchat';
            importer = SNAPCHAT;
            reasons.push('filen ligger i Snapchats cache' + (sc.path ? ' (' + sc.path + ')' : ''));
            if (sc.context != null) reasons.push('cache_controller MEDIA_CONTEXT_TYPE ' + sc.context + (sc.known && sc.label ? ' = ' + sc.label : ', okänd typ'));
            else reasons.push('ingen rad i cache_controller för filen');
            var ext = sc.external || {};
            if (ext.kind === 'recording') reasons.push('EXTERNAL_KEY är ett inspelnings-id');
            if (ext.kind === 'message') reasons.push('EXTERNAL_KEY pekar på meddelande ' + ext.serverMessageId + ' i chatten' + (sc.who ? ', avsändare ' + sc.who : ''));
            if (ext.kind === 'chat') reasons.push('EXTERNAL_KEY är chattmediets id (chat_snap-' + ext.snapId + ')' + (sc.messageCreatedMs ? ', samma id står i meddelandet i arroyo.db' : '') + (sc.who ? ', avsändare ' + sc.who : ''));
            if (ext.kind === 'sent') reasons.push('EXTERNAL_KEY anger mottagaren @' + ext.recipient);
            if (sc.recordingCopy) reasons.push('samma bytes finns i recorded_videos');
        } else if (platform === 'Android') {
            if (rel.indexOf('dcim/camera') === 0 || isCameraApp(importer, opts.cameraApps)) {
                type = 'camera';
                reasons.push(rel.indexOf('dcim/camera') === 0 ? 'relative_path börjar med DCIM/Camera' : 'owner_package_name är en kameraapp (' + importer + ')');
            } else if (rel.indexOf('screenshots') >= 0 || name.indexOf('screenshot') === 0) {
                type = 'screenshot';
                reasons.push(rel.indexOf('screenshots') >= 0 ? 'relative_path innehåller Screenshots' : 'filnamnet börjar med Screenshot');
            } else if (importer) {
                type = 'saved';
                reasons.push('owner_package_name är ' + importer);
            }
            if (file.createdFrom === 'date_added') reasons.push('datetaken saknas i MediaStore, så T är date_added');
            if (file.memory) {
                var mem = file.memory;
                reasons.push('Snapchats Memories har en ' + (mem.video ? 'video' : 'bild') + ' tagen med ' + (mem.front ? 'frontkameran' : 'bakre kameran') + ' ' + formatUtc(mem.capturedMs) +
                    ' och sparad ' + duration(Math.abs((file.addedMs || file.createdMs) - mem.createdMs)) + ' ' + (mem.createdMs <= (file.addedMs || file.createdMs) ? 'före' : 'efter') + ' filen (snap_capture_time, create_time, front_facing)');
            }
        } else {
            if (file.chatTemp) {
                // En fil i en chattapps tmp/, utan rad i bildbiblioteket.
                type = 'saved';
                importer = file.chatTemp.app;
                reasons.push('filen ligger i ' + file.chatTemp.appName + 's tillfälliga mapp (' + file.chatTemp.path + ')');
            } else if (importedBy === 1 || importedBy === 2 || importer === IOS_CAMERA) {
                type = 'camera';
                reasons.push(importedBy === 1 || importedBy === 2 ? 'ZIMPORTEDBY ' + importedBy + ' (' + (importedBy === 1 ? 'bakre' : 'främre') + ' kameran enligt iLEAPP)' : 'skaparappen är com.apple.camera');
            } else if (importer === IOS_SPRINGBOARD || Number(file.kindSubtype) === 10) {
                // ZIMPORTEDBY 8 räcker inte: i labbet har också en bild ur Safari och en dubblett i Bilder 8.
                type = 'screenshot';
                if (importedBy === 8) reasons.push('ZIMPORTEDBY 8');
                if (importer === IOS_SPRINGBOARD) reasons.push('skaparappen är com.apple.springboard');
                if (Number(file.kindSubtype) === 10) reasons.push('ZKINDSUBTYPE 10');
            } else if (importedBy === 13 || importer === IOS_SHARINGD) {
                // ZIMPORTEDBY 13 står kvar när en dubblett skriver om skaparappen på originalet (labbet).
                type = 'saved';
                transfer = 'airdrop';
                if (importedBy === 13) reasons.push('ZIMPORTEDBY 13');
                if (importer) reasons.push('skaparappen är ' + importer);
                importer = IOS_SHARINGD;
            } else if (importer === IOS_PHOTOS) {
                type = 'saved';
                transfer = 'photos';
                if (importedBy != null) reasons.push('ZIMPORTEDBY ' + importedBy);
                reasons.push('skaparappen är ' + importer);
            } else if (importedBy === 3 || importedBy === 6 || importedBy === 8 || importedBy === 9 || importer) {
                type = 'saved';
                if (importedBy != null) reasons.push('ZIMPORTEDBY ' + importedBy);
                if (importer) reasons.push('skaparappen är ' + importer);
            }
        }
        // ZMODIFICATIONDATE ändras av mycket annat än redigering (favorit, album, synk), så bara
        // en redigeringsapp räknas som tecken på redigering. Ändrad-tiden visas ändå i tidslinjen.
        if (file.editor) flags.push('edited');
        if (file.addedMs && file.createdMs && file.addedMs - file.createdMs > LATE_MS) flags.push('received-later');
        if (Number(file.trashed) === 1) flags.push('trashed');
        if (Number(file.hidden) === 1) flags.push('hidden');
        var labels = { camera: 'Kamerabild', screenshot: 'Skärmdump', saved: 'Sparad ur en app', snapchat: 'Snapchat-media utanför bildbiblioteket', unknown: 'Okänd typ' };
        var label = chat ? chat.appName + '-media utanför bildbiblioteket' : transfer === 'airdrop' ? 'Mottagen med AirDrop' : transfer === 'photos' ? 'Skapad i Bilder (till exempel en dubblett)'
            : file.chatTemp ? file.chatTemp.appName + 's tillfälliga fil' : labels[type];
        return { type: type, label: label, reasons: reasons, flags: flags, importer: importer, importedBy: importedBy, chat: chat, transfer: transfer, chatTemp: file.chatTemp || null,
            snapchat: type === 'snapchat' || isSnapchatApp(importer), origin: snapOrigin(sc), who: sc && sc.who || null, recipient: sc && sc.external && sc.external.recipient || null,
            memory: file.memory || null };
    }

    // Klockslag i rapportens zon, med datum och, om zonen är bildens fasta förskjutning, zonen när det är
    // en annan dag än T. Bildens förskjutning gäller vid tagningen och kan vara en annan än vid tiden som visas.
    function stamper(input) {
        var fmt = input.format || formatUtc;
        var T = input.file.createdMs;
        return function (ms) {
            if (T && fmt(ms).slice(0, 10) === fmt(T).slice(0, 10)) return fmt(ms).slice(11, 19);
            return fmt(ms).slice(0, 19) + (input.fixedZone ? ' (' + input.fixedZone + ')' : '');
        };
    }

    // ---------- Fönster ----------

    function windows(file, windowMs) {
        windowMs = windowMs || 15 * MINUTE;
        var out = [];
        if (file.createdMs) out.push({ id: 'created', label: 'när filen skapades', centerMs: file.createdMs, startMs: file.createdMs - windowMs, endMs: file.createdMs + windowMs });
        if (file.addedMs && (!file.createdMs || file.addedMs - file.createdMs > windowMs)) {
            out.push({ id: 'added', label: 'när filen kom till telefonen', centerMs: file.addedMs, startMs: file.addedMs - windowMs, endMs: file.addedMs + windowMs });
        }
        // Egna fönster, t.ex. när Snapchat-meddelandet som filen hör till skickades.
        (file.extraWindows || []).forEach(function (w) {
            if (w.centerMs == null || out.some(function (o) { return Math.abs(o.centerMs - w.centerMs) <= windowMs; })) return;
            out.push({ id: w.id, label: w.label, centerMs: w.centerMs, startMs: w.centerMs - windowMs, endMs: w.centerMs + windowMs });
        });
        // Närbilden: en tiondel av fönstret åt varje håll, minst 30 s. ±15 min ger ±90 s.
        var half = Math.max(30000, Math.round(windowMs / 10));
        out.forEach(function (w) { w.closeup = { id: w.id + '-closeup', label: 'närbild', centerMs: w.centerMs, startMs: w.centerMs - half, endMs: w.centerMs + half }; });
        return out;
    }

    function unionRange(wins) {
        var s = Infinity, e = -Infinity;
        wins.forEach(function (w) { s = Math.min(s, w.startMs); e = Math.max(e, w.endMs); });
        return { startMs: s, endMs: e };
    }

    // ---------- Android: händelser -> intervall ----------

    // Wellbeing/UsageEvents: 1 RESUMED, 2 PAUSED, 23 STOPPED, 15/16 skärm, 17/18 låsskärm.
    // events: [{ ms, type, app }]. Returnerar { apps, screen, lock } i samma form som iOS-raderna.
    function intervalsFromEvents(events, rangeEndMs, source) {
        var open = {};
        var apps = [];
        var screen = [];
        var lock = [];
        var screenOn = null;
        var lockState = null;
        var sorted = events.slice().sort(function (a, b) { return a.ms - b.ms; });
        sorted.forEach(function (e) {
            var t = Number(e.type);
            if (t === 1) {
                if (open[e.app] == null) open[e.app] = e.ms;
            } else if (t === 2 || t === 23) {
                if (open[e.app] != null) {
                    apps.push({ startMs: open[e.app], endMs: e.ms, app: e.app, stream: 'wellbeing', source: source });
                    delete open[e.app];
                }
            } else if (t === 15 || t === 16) {
                if (screenOn) { screenOn.endMs = e.ms; screen.push(screenOn); screenOn = null; }
                screenOn = { startMs: e.ms, endMs: null, on: t === 15, stream: 'wellbeing', source: source };
            } else if (t === 17 || t === 18) {
                if (lockState) { lockState.endMs = e.ms; lock.push(lockState); lockState = null; }
                lockState = { startMs: e.ms, endMs: null, locked: t === 17, stream: 'wellbeing', source: source };
            }
        });
        Object.keys(open).forEach(function (app) { apps.push({ startMs: open[app], endMs: rangeEndMs, app: app, stream: 'wellbeing', source: source, openEnded: true }); });
        if (screenOn) { screenOn.endMs = rangeEndMs; screenOn.openEnded = true; screen.push(screenOn); }
        if (lockState) { lockState.endMs = rangeEndMs; lockState.openEnded = true; lock.push(lockState); }
        apps.sort(function (a, b) { return a.startMs - b.startMs; });
        return { apps: apps, screen: screen, lock: lock };
    }

    // Täta intervall från samma app slås ihop, så att förklaringen inte fylls av brus.
    function mergeIntervals(list, gapMs) {
        gapMs = gapMs == null ? MERGE_GAP_MS : gapMs;
        var out = [];
        list.slice().sort(function (a, b) { return a.startMs - b.startMs; }).forEach(function (iv) {
            var last = out[out.length - 1];
            if (last && last.app === iv.app && last.stream === iv.stream && iv.startMs - last.endMs <= gapMs) {
                // Slutet är det senare intervallets, och är det öppet är det hopslagna också öppet.
                if (iv.endMs >= last.endMs) { last.endMs = iv.endMs; last.openEnded = iv.openEnded; }
                last.merged = (last.merged || 1) + 1;
            } else {
                out.push(Object.assign({}, iv));
            }
        });
        return out;
    }

    // ---------- Händelselistan ----------

    function inRange(ms, range) { return ms != null && ms >= range.startMs && ms <= range.endMs; }

    // Ligger tiden i något av fönstren? Queryerna läser hela spannet från det första fönstrets början
    // till det sista fönstrets slut; det som ligger mellan fönstren sorteras bort här.
    function inWindows(ms, wins) { return (wins || []).some(function (w) { return inRange(ms, w); }); }

    function fileVerb(type, platform) {
        var t = typeof type === 'string' ? type : type.type;
        if (t === 'camera') return 'tas med kameran';
        if (t === 'screenshot') return 'tas';
        if (t === 'saved') return 'sparas';
        if (t === 'snapchat') {
            var o = typeof type === 'string' ? null : type.origin;
            return o === 'recorded' ? 'spelas in med Snapchats kamera' : o === 'sent' ? 'skickas i Snapchat' : o === 'received' ? 'tas emot i Snapchat' : 'läggs i Snapchats cache';
        }
        return 'skapas';
    }

    function fileNoun(type) { return type === 'screenshot' ? 'Skärmdumpen' : type === 'snapchat' ? 'Filen' : 'Bilden'; }

    function buildEvents(input, type, wins) {
        var file = input.file;
        var names = input.appNames;
        var range = unionRange(wins);
        var events = [];
        var outside = 0;
        var fileSrc = input.fileSource || {};

        function add(e) {
            if (e.ms == null) return;
            if (!inRange(e.ms, range) && !(e.endMs != null && e.endMs >= range.startMs && e.ms <= range.endMs)) { outside++; return; }
            events.push(e);
        }

        var noun = fileNoun(type.type);
        var created = { ms: file.createdMs, kind: 'file-created', lane: 'file', bold: true,
            text: 'Skapad (' + (fileSrc.column || (input.platform === 'Android' ? 'datetaken' : 'ZDATECREATED')) + ')',
            // För en fil i Snapchats cache berättar Snapchat-händelsen vad som hände, så raden här får ingen egen mening.
            plain: type.type === 'snapchat' ? null : noun + ' ' + file.filename + ' ' + fileVerb(type, input.platform) +
                (type.type === 'saved' && type.importer ? ' av ' + appName(type.importer, names) : ''),
            source: fileSrc };
        add(created);
        if (file.addedMs && Math.abs(file.addedMs - (file.createdMs || 0)) > TOLERANCE_MS) {
            add({ ms: file.addedMs, kind: 'file-added', lane: 'file', text: 'Tillagd i biblioteket (' + (input.platform === 'Android' ? 'date_added' : 'ZADDEDDATE') + ')',
                plain: noun + ' läggs till i ' + (input.platform === 'Android' ? 'galleriet' : 'Bilder'), source: Object.assign({}, fileSrc, { column: input.platform === 'Android' ? 'date_added' : 'ZADDEDDATE' }) });
        }
        if (file.modifiedMs && Math.abs(file.modifiedMs - (file.createdMs || 0)) > TOLERANCE_MS && Math.abs(file.modifiedMs - (file.addedMs || 0)) > TOLERANCE_MS) {
            add({ ms: file.modifiedMs, kind: 'file-modified', lane: 'file', text: 'Ändrad (' + (input.platform === 'Android' ? 'date_modified' : 'ZMODIFICATIONDATE') + ')',
                plain: noun + ' ändras' + (file.editor ? ' av ' + appName(file.editor, names) : ''), source: Object.assign({}, fileSrc, { column: input.platform === 'Android' ? 'date_modified' : 'ZMODIFICATIONDATE' }) });
        }
        if (input.exif && input.exif.takenMs) {
            add({ ms: input.exif.takenMs, kind: 'exif', lane: 'file', text: 'EXIF i filen: ' + (input.exif.sourceTag || 'DateTimeOriginal') + ' ' + input.exif.takenText,
                plain: null, source: input.exif.source || { db: 'bildfilen', table: 'EXIF' } });
        }
        if (input.fileEntry && input.fileEntry.mtimeMs) {
            add({ ms: input.fileEntry.mtimeMs, kind: 'fs-mtime', lane: 'file', text: 'Ändrad i filsystemet', plain: null,
                source: { db: 'zippen', table: input.fileEntry.name, column: 'ändringstid' } });
        }
        if (input.pairedVideo && input.pairedVideo.takenMs) {
            add({ ms: input.pairedVideo.takenMs, kind: 'paired-video', lane: 'file', text: 'Live Photo-videon ' + input.pairedVideo.name + ' (QuickTime CreateDate, UTC)',
                plain: null, source: input.pairedVideo.source || { db: 'bildfilen', table: 'QuickTime' } });
        }
        // Android: Snapchats Memories säger när bilden togs; Snapchat-händelsen bär meningen.
        if (file.memory && file.capturedMs) {
            add({ ms: file.capturedMs, kind: 'file-captured', lane: 'file', bold: true,
                text: 'Tagen enligt Snapchats Memories (snap_capture_time, ' + (file.memory.front ? 'frontkameran' : 'bakre kameran') + (file.memory.video ? ', inspelningens slut' : '') + ')',
                plain: null, source: file.memory.source || { db: 'memories.db', table: 'memories_snap', column: 'snap_capture_time' } });
        }

        (input.neighbours || []).forEach(function (n) {
            if (file.pk != null && n.pk === file.pk) return;
            if (n.filename === file.filename) return;
            var nType = classify(n, input.platform, input);
            add({ ms: n.createdMs, kind: 'neighbour', lane: 'file', text: 'Granne: ' + n.filename + (n.importer ? ' (' + n.importer + ')' : ''),
                plain: fileNoun(nType.type) + ' ' + n.filename + ' ' + fileVerb(nType, input.platform), neighbour: true, app: n.importer, source: input.neighbourSource || fileSrc });
        });

        // Händelser från andra källor, färdigbyggda (Snapchat). De filtreras på fönstret som allt annat.
        (input.extraEvents || []).forEach(function (e) { add(Object.assign({}, e)); });

        var appIvs = mergeIntervals(input.appIntervals || []);
        appIvs.forEach(function (iv) {
            var name = appName(iv.app, names);
            var lane = isCameraApp(iv.app, input.cameraApps) ? 'camera' : 'app';
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'app', lane: lane, app: iv.app, stream: iv.stream, openEnded: iv.openEnded,
                text: name + ' igång (' + iv.stream + ')', plain: name + ' öppnas', plainEnd: name + ' lämnas', source: iv.source });
        });
        // Kameran per app: ur appops (op 26) på Android och PowerLog (PLCameraAgent) på iOS. Kamerabandet,
        // inte appbandet: appen själv står redan i appraden. Utan slutrad är slutet okänt och bandet en
        // sekund långt. Tätt följande kameraoperationer från samma app (kameran öppnas igen inom två
        // sekunder, t.ex. vid byte mellan fram- och bakkamera) slås ihop till ett intervall.
        var camUse = mergeIntervals((input.cameraUse || []).map(function (iv) {
            return { startMs: iv.startMs, endMs: iv.endMs != null ? iv.endMs : iv.startMs + 1000, app: iv.app, stream: iv.stream || 'appops', source: iv.source, openEnded: iv.endMs == null };
        }));
        camUse.forEach(function (iv) {
            var name = appName(iv.app, names);
            var pl = iv.stream === 'PowerLog';
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'app', lane: 'camera', app: iv.app, stream: iv.stream, openEnded: !!iv.openEnded, cameraOp: true, merged: iv.merged || null,
                text: name + ' använder kameran (' + (pl ? 'PowerLog, PLCameraAgent' : 'appops op 26') + (iv.merged ? ', ' + iv.merged + (pl ? ' sessioner' : ' operationer') + ' i följd' : '') + (iv.openEnded ? ', slutet inte registrerat' : '') + ')', plain: name + ' startar kameran', plainEnd: name + ' stänger kameran', source: iv.source });
        });
        (input.screen || []).forEach(function (iv) {
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'screen', lane: 'screen', on: !!iv.on, stream: iv.stream, openEnded: iv.openEnded,
                text: iv.on ? 'Skärmen tänd' : 'Skärmen släckt', plain: iv.on ? 'Skärmen tänds' : 'Skärmen släcks', plainEnd: iv.on ? 'Skärmen släcks' : null, source: iv.source });
        });
        (input.lock || []).forEach(function (iv) {
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'lock', lane: 'lock', locked: !!iv.locked, stream: iv.stream, openEnded: iv.openEnded,
                text: iv.locked ? 'Telefonen låst' : 'Telefonen olåst', plain: iv.locked ? 'Telefonen låses' : 'Telefonen låses upp',
                plainEnd: iv.locked ? 'Telefonen låses upp' : 'Telefonen låses', source: iv.source });
        });
        (input.locations || []).forEach(function (p) {
            add({ ms: p.ms, kind: 'location', lane: 'location', lat: p.lat, lon: p.lon, accuracy: p.accuracy, locType: p.type,
                text: 'Position ' + p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) + ' (±' + Math.round(p.accuracy) + ' m, ' + (p.type === 1 ? 'GNSS' : p.type === 4 ? 'Wi-Fi' : 'typ ' + p.type) + ')',
                plain: null, source: p.source || input.locationSource });
        });

        events.sort(function (a, b) { return a.ms - b.ms || (a.endMs || a.ms) - (b.endMs || b.ms); });
        events.forEach(function (e, i) { e.id = i + 1; });
        return { events: events, outside: outside };
    }

    // ---------- Bedömning ----------

    function coverageReason(key, coverage, missingDbs, ms, dbLabel) {
        if (missingDbs && missingDbs[key] === 'unread') return dbLabel + ' kunde inte läsas (felet står bland varningarna).';
        if (missingDbs && missingDbs[key]) return dbLabel + ' finns inte i extraktionen.';
        var c = coverage && coverage[key];
        if (c && c.rows === 0) return dbLabel + ' har inga rader i strömmen.';
        if (c && c.firstMs != null && c.lastMs != null && (ms < c.firstMs || ms > c.lastMs)) {
            return 'Tidpunkten ligger utanför ' + dbLabel + ':s täckning (' + formatUtc(c.firstMs) + ' till ' + formatUtc(c.lastMs) + ').';
        }
        return 'Inga registreringar i tidsfönstret.';
    }

    // Skälet till att en registrering saknas vid T: knowledgeC:s (eller Androids loggs) täckning och, på
    // iOS, PowerLogs täckning och glapp.
    function reasonAt(input, key, ms, label) {
        var r = coverageReason(key, input.coverage, input.missingDbs, ms, label);
        if (input.platform === 'Android') return r;
        var c = input.coverage && input.coverage.PowerLog;
        if (!c) return r + (input.missingDbs && input.missingDbs.PowerLog === 'unread' ? ' PowerLog kunde inte läsas.' : '');
        var gap = (c.gaps || []).find(function (g) { return g.startMs <= ms && ms <= g.endMs; });
        if (gap) return r + ' PowerLog har ett glapp från ' + formatUtc(gap.startMs) + ' till ' + formatUtc(gap.endMs) + ': telefonen var avstängd eller PowerLog skrev inte.';
        if (c.firstMs != null && c.lastMs != null && (ms < c.firstMs || ms > c.lastMs)) return r + ' Tidpunkten ligger också utanför PowerLogs täckning (' + formatUtc(c.firstMs) + ' till ' + formatUtc(c.lastMs) + ').';
        return r + ' PowerLog har inga registreringar heller.';
    }

    // Var en kameraanvändning per app kommer ifrån: Androids appops (op 26) eller PowerLog på iOS.
    function camSource(e) { return e && e.stream === 'PowerLog' ? 'PowerLog (PLCameraAgent)' : 'appops (op 26)'; }

    function factorTime(input, type) {
        var file = input.file;
        var items = [];
        var state = 'missing';
        if (!file.createdMs) {
            return { id: 'time', title: 'Skapandetid', state: 'missing', items: [{ state: 'missing', text: 'Skapandetiden saknas i databasen.' }],
                plain: 'Det går inte att se när filen skapades.' };
        }
        // Klockslag i rapportens zon, med datum bara när det är ett annat än T:s.
        var at = stamper(input);
        var apart = function (ms, ref) { return Math.abs(ms) < 1000 ? 'samma sekund som ' + ref : duration(ms) + (ms < 0 ? ' före ' : ' efter ') + ref; };
        if (file.createdFrom === 'date_added') {
            items.push({ state: 'info', text: 'Tagningstiden (datetaken) saknas i MediaStore, så T är när filen lades till i galleriet (date_added), inte när bilden togs. Så ser filer ut som en app sparar till galleriet utan tid i EXIF.' });
        } else if (file.addedMs) {
            var diff = file.addedMs - file.createdMs;
            var pair = 'Skapad ' + at(file.createdMs) + ', tillagd i biblioteket ' + at(file.addedMs) + ': ';
            // Tiondelar bara när båda tiderna har dem: date_added på Android och zippens tider har hela sekunder.
            var tenths = file.createdMs % 1000 && file.addedMs % 1000 && Math.abs(diff) < 1000 ? Math.round(Math.abs(diff) / 100) : 0;
            var gap = tenths ? (tenths / 10).toFixed(1).replace('.', ',') + ' s' + (diff < 0 ? ' före' : ' efter') + ' Skapad' : apart(diff, 'Skapad');
            if (Math.abs(diff) <= SAME_TIME_MS) items.push({ state: 'support', text: pair + gap + ' (inom en minut).' });
            else if (diff > LATE_MS) items.push({ state: 'contradiction', text: pair + duration(diff) + ' senare. Så ser bilder ut som har tagits emot, synkats eller förts över från en annan enhet.' });
            else items.push({ state: 'info', text: pair + duration(diff) + (diff < 0 ? ' före' : ' efter') + '.' + (diff < 0 ? ' Filen lades alltså till innan den skapades. Det händer när tiden har ändrats i efterhand eller när klockan i enheten som tog bilden gick fel.' : '') });
        } else if (type.type === 'snapchat') {
            items.push({ state: 'info', text: 'Filen ligger utanför bildbiblioteket, så det finns ingen Tillagd-tid. T är tiden då Snapchat registrerade filen i sin cache.' });
        } else {
            items.push({ state: 'info', text: 'Tiden då filen lades till i biblioteket saknas.' });
        }
        if (file.memory && file.capturedMs) {
            var mem = file.memory;
            var mAnchor = file.addedMs || file.createdMs;
            var mdiffCap = mAnchor - file.capturedMs;
            var okMem = mdiffCap >= -TOLERANCE_MS && mdiffCap <= 10 * MINUTE;
            items.push({ state: okMem ? 'support' : 'info', text: 'Snapchats Memories: ' + (mem.video ? 'videon spelades in' : 'bilden togs') + ' ' + formatUtc(file.capturedMs) + ' med ' + (mem.front ? 'frontkameran' : 'bakre kameran') +
                ' och sparades i Memories ' + formatUtc(mem.createdMs) + ', ' + duration(Math.abs(mAnchor - mem.createdMs)) + ' ' + (mem.createdMs <= mAnchor ? 'före' : 'efter') + ' att filen lades till i galleriet (snap_capture_time, create_time).' });
        }
        var scm = type.type === 'snapchat' && file.snapchatCache && file.snapchatCache.messageCreatedMs;
        if (input.exif && input.exif.takenMs && scm) {
            // Mottagen via chatten: tiden inuti filen hör till avsändaren, så den jämförs med när meddelandet skickades.
            var mdiff = input.exif.takenMs - scm;
            var cdiff = input.exif.takenMs - file.createdMs;
            if (Math.abs(mdiff) <= SAME_TIME_MS) items.push({ state: 'support', text: 'Tiden i själva bildfilen (EXIF) är ' + input.exif.takenText + ' och stämmer med när meddelandet skickades (' + formatUtc(scm) + ').' });
            else items.push({ state: 'info', text: 'Tiden i själva bildfilen (EXIF) är ' + input.exif.takenText + ', ' + duration(mdiff) + (mdiff < 0 ? ' före' : ' efter') + ' att meddelandet skickades (' + formatUtc(scm) + ').' });
            if (Math.abs(cdiff) > SAME_TIME_MS) items.push({ state: 'info', text: 'Filen lades i cachen på den här telefonen ' + duration(cdiff) + (cdiff < 0 ? ' efter' : ' före') + ' tiden inuti filen.' });
        } else if (input.exif && input.exif.takenMs) {
            var ediff = input.exif.takenMs - file.createdMs;
            if (Math.abs(ediff) <= SAME_TIME_MS) items.push({ state: 'support', text: 'Tiden i själva bildfilen (EXIF) är ' + input.exif.takenText + ': ' + apart(ediff, 'Skapad') + '.' });
            else items.push({ state: 'contradiction', text: 'Tiden i själva bildfilen (EXIF) är ' + input.exif.takenText + ': ' + duration(ediff) + (ediff < 0 ? ' före' : ' efter') + ' Skapad. Det kan bero på att filen har redigerats, fått en ny tid eller kommer från en annan enhet.' });
        } else if (input.exif && input.exif.read) {
            items.push({ state: 'info', text: 'Filen har ingen EXIF-tid' + (type.type === 'screenshot' ? ', vilket är normalt för en skärmdump' : '') + '.' });
        } else {
            items.push({ state: 'info', text: 'Själva filen lästes inte' + (input.fileMissingReason ? ': ' + input.fileMissingReason : '') + '.' });
        }
        if (input.exif && (input.exif.make || input.exif.model) && (file.cameraMake || file.cameraModel)) {
            var fileDev = lower((input.exif.make || '') + ' ' + (input.exif.model || '')).replace(/\s+/g, ' ').trim();
            var dbDev = lower((file.cameraMake || '') + ' ' + (file.cameraModel || '')).replace(/\s+/g, ' ').trim();
            if (fileDev === dbDev || fileDev.indexOf(dbDev) >= 0 || dbDev.indexOf(fileDev) >= 0) items.push({ state: 'support', text: 'Kameramodellen i bildfilen (Make/Model ' + ((input.exif.make || '') + ' ' + (input.exif.model || '')).trim() + ') är densamma som i databasen.' });
            else items.push({ state: 'contradiction', text: 'Kameramodellen i bildfilen (Make/Model ' + ((input.exif.make || '') + ' ' + (input.exif.model || '')).trim() + ') är inte densamma som i databasen (' + ((file.cameraMake || '') + ' ' + (file.cameraModel || '')).trim() + ').' });
        }
        if (input.fileEntry && input.fileEntry.mtimeMs) {
            var fdiff = input.fileEntry.mtimeMs - file.createdMs;
            items.push({ state: Math.abs(fdiff) <= SAME_TIME_MS ? 'support' : 'info', text: 'Ändrad i filsystemet ' + at(input.fileEntry.mtimeMs) + ', ' + apart(fdiff, 'Skapad') + '.' });
        }
        // Skapandetiden i filsystemet: när filen kom till på telefonen. Senare än Skapad är vanligt för
        // filer som har kopierats, tagits emot eller återställts, så den motsäger inget. ctime och den
        // osäkra tredje UT-tiden flyttas av annat än filens tillkomst, så de redovisas utan slutsats.
        if (input.fileEntry && input.fileEntry.createdMs) {
            var cdiff2 = input.fileEntry.createdMs - file.createdMs;
            items.push({ state: Math.abs(cdiff2) <= SAME_TIME_MS ? 'support' : 'info', text: 'Skapad i filsystemet ' + at(input.fileEntry.createdMs) + ', ' + apart(cdiff2, 'Skapad') + '.' +
                (cdiff2 > 0 && cdiff2 <= 5 * MINUTE && /\.hei[cf]$/i.test(input.fileEntry.name || file.filename || '') ? ' iOS skriver HEIC-filen färdigt efter att bilden tagits (9–50 s i labbet, med och utan Live Photo).'
                    : cdiff2 > SAME_TIME_MS ? ' Filen kom alltså till i filsystemet senare än den skapades, som när en fil kopieras, tas emot eller återställs.' : '') +
                (file.addedMs && file.addedMs - input.fileEntry.createdMs > LATE_MS ? ' En kopia eller överföring kan behålla källans tid (AirDrop och dubbletter i Bilder gör det i labbet), så tiden säger inte när filen kom till telefonen.' : '') });
        }
        if (input.fileEntry && input.fileEntry.changedMs) {
            items.push({ state: 'info', text: 'Metadata ändrad i filsystemet (ctime) ' + at(input.fileEntry.changedMs) + ', ' + apart(input.fileEntry.changedMs - file.createdMs, 'Skapad') + '. Tiden flyttas också när filens metadata ändras, så den säger inte när filen kom till.' });
        }
        if (input.fileEntry && input.fileEntry.thirdMs) {
            items.push({ state: 'info', text: 'Tredje tiden i zippen (skapad eller ctime) ' + at(input.fileEntry.thirdMs) + ', ' + apart(input.fileEntry.thirdMs - file.createdMs, 'Skapad') + '. Vilken av dem det är syns inte i zippen.' });
        }
        if (file.adjustedAtMs) items.push({ state: 'info', text: 'Redigerad i bildbiblioteket ' + at(file.adjustedAtMs) + ' (ZADJUSTMENTTIMESTAMP). Originalfilen ändras inte; den redigerade versionen ligger under PhotoData/Mutations/.' });
        if (Number(file.trashed) === 1) items.push({ state: 'info', text: 'Flyttad till Raderade' + (file.trashedAtMs ? ' ' + at(file.trashedAtMs) + ' (ZTRASHEDDATE)' : '') + '. Filen ligger kvar tills den rensas.' });
        if (items.some(function (i) { return i.state === 'contradiction'; })) state = 'contradiction';
        else if (items.some(function (i) { return i.state === 'support'; })) state = 'support';
        else state = 'info';
        var plain;
        if (state === 'support' && type.type === 'snapchat' && scm) plain = 'Tiderna hänger ihop: ' + (input.exif && input.exif.takenMs ? 'tiden inuti filen stämmer med när meddelandet skickades, och ' : '') + 'filen hämtades till den här telefonen ' + duration(file.createdMs - scm) + ' efter att meddelandet skickades.';
        else if (state === 'support' && type.type === 'snapchat') plain = 'Tiderna hänger ihop: ' + (input.exif && input.exif.takenMs ? 'tiden inuti filen och ' : '') + 'filsystemets tid stämmer med när Snapchat registrerade filen.';
        else if (state === 'support' && file.memory && file.capturedMs) plain = 'Tiderna hänger ihop: enligt Snapchats Memories ' + (file.memory.video ? 'spelades videon in' : 'togs bilden') + ' ' + duration(Math.abs((file.addedMs || file.createdMs) - file.capturedMs)) + ' innan den sparades till galleriet.';
        else if (state === 'support') plain = 'Tiderna hänger ihop: ' + (file.addedMs && Math.abs(file.addedMs - file.createdMs) <= SAME_TIME_MS ? 'filen lades till i biblioteket inom en minut från skapandetiden' + (input.exif && input.exif.takenMs ? ', och tiden inuti filen säger detsamma' : '') : input.exif && input.exif.takenMs ? 'tiden inuti filen stämmer med skapandetiden' : 'filsystemets tid stämmer med skapandetiden') + '.';
        else if (state === 'contradiction') plain = 'Tiderna hänger inte ihop. ' + items.filter(function (i) { return i.state === 'contradiction'; }).map(function (i) { return i.text; }).join(' ');
        else plain = 'Tiderna går inte att kontrollera mot varandra.';
        return { id: 'time', title: 'Skapandetid', state: state, items: items, plain: plain };
    }

    // ---------- Positioner ----------

    function validCoord(lat, lon) {
        lat = Number(lat); lon = Number(lon);
        // Photos.sqlite skriver -180 när positionen saknas.
        return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) && lat !== -180;
    }

    function distanceM(a, b) {
        var R = 6371000;
        var p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
        var dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
        var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function metres(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }

    // Alla positioner som hör till bedömningen: bildens egen enligt databasen, bildens enligt
    // EXIF i filen, och telefonens enligt routined. Avståndet räknas från bildens position.
    function positions(input) {
        var file = input.file;
        var out = [];
        var filePos = null;
        if (validCoord(file.latitude, file.longitude)) {
            filePos = { lat: Number(file.latitude), lon: Number(file.longitude) };
            out.push({ kind: 'file', ms: file.createdMs, lat: filePos.lat, lon: filePos.lon, accuracy: null, label: 'Bilden enligt databasen',
                source: input.fileSource ? Object.assign({}, input.fileSource, { column: input.platform === 'Android' ? 'latitude, longitude' : 'ZLATITUDE, ZLONGITUDE' }) : null });
        }
        var ex = input.exif && input.exif.position;
        if (ex && validCoord(ex.lat, ex.lon)) {
            var exPos = { lat: Number(ex.lat), lon: Number(ex.lon) };
            if (!filePos) filePos = exPos;
            out.push({ kind: 'exif', ms: file.createdMs, lat: exPos.lat, lon: exPos.lon, accuracy: ex.accuracy || null, label: 'Bilden enligt EXIF i filen',
                source: { db: 'bildfilen', table: file.filename, column: ex.source || 'GPS' } });
        }
        // Android: positionen Snapchat sparade med snappen i Memories. MediaStore-raden saknar position.
        var mem = file.memory;
        if (mem && validCoord(mem.latitude, mem.longitude)) {
            var memPos = { lat: Number(mem.latitude), lon: Number(mem.longitude) };
            if (!filePos) filePos = memPos;
            out.push({ kind: 'memory', ms: file.capturedMs || file.createdMs, lat: memPos.lat, lon: memPos.lon, accuracy: null, label: 'Bilden enligt Snapchats Memories',
                source: mem.source || { db: 'memories.db', table: 'memories_snap', column: 'latitude, longitude' } });
        }
        (input.locations || []).forEach(function (l) {
            out.push({ kind: 'phone', ms: l.ms, lat: l.lat, lon: l.lon, accuracy: l.accuracy, locType: l.type,
                label: 'Telefonen (' + (l.type === 1 ? 'GNSS' : l.type === 4 ? 'Wi-Fi' : 'typ ' + l.type) + ')', source: l.source || input.locationSource || null });
        });
        out.forEach(function (p) {
            p.distanceM = filePos && p.kind === 'phone' ? distanceM(filePos, p) : ((p.kind === 'exif' || p.kind === 'memory') && out[0].kind === 'file' ? distanceM(out[0], p) : null);
            p.offsetMs = file.createdMs != null && p.ms != null ? p.ms - file.createdMs : null;
        });
        return { list: out, filePos: filePos };
    }

    function factorPosition(input, pos, type, wins) {
        var file = input.file;
        var noun = type && type.type === 'snapchat' ? 'filen' : 'bilden';
        var Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
        // Bara positionerna i fönstret runt T jämförs. Positioner i ett annat fönster (när filen kom till
        // telefonen, när Snapchat-meddelandet skickades) visas på kartan men säger inget om T.
        var span = input.windowMs || 15 * MINUTE;
        var logged = pos.list.filter(function (p) { return p.kind === 'phone'; });
        var phone = logged.filter(function (p) { return p.offsetMs != null && Math.abs(p.offsetMs) <= span; });
        var elsewhere = logged.filter(function (p) { return phone.indexOf(p) < 0; });
        var otherLabels = (wins || []).filter(function (w) {
            return w.id !== 'created' && elsewhere.some(function (p) { return inRange(p.ms, w); });
        }).map(function (w) { return w.label; });
        var other = elsewhere.length ? { state: 'info', text: elsewhere.length + (elsewhere.length === 1 ? ' position till ligger' : ' positioner till ligger') +
            (otherLabels.length ? ' i fönstret ' + otherLabels.join(' och ') : ' utanför fönstret runt T') + '. De visas på kartan men räknas inte här, eftersom de inte gäller T.' } : null;
        var withOther = function (list) { return other ? list.concat([other]) : list; };
        var items = [];
        var near = null;
        phone.forEach(function (p) { if (near === null || Math.abs(p.offsetMs) < Math.abs(near.offsetMs)) near = p; });
        var noPhoneLog = input.platform === 'Android' ? ' (ingen positionslogg läses på Android)' : input.missingDbs && input.missingDbs.routined === 'unread' ? ' (routined Cache.sqlite kunde inte läsas)' : input.missingDbs && input.missingDbs.routined ? ' (routined Cache.sqlite finns inte i extraktionen)' : '';
        if (!pos.filePos) {
            if (!phone.length) {
                return { id: 'position', title: 'Position', state: 'missing', items: withOther([{ state: 'missing', text: 'Filen har ingen position, och telefonen har inga registrerade positioner i fönstret' + noPhoneLog + '.' }]),
                    plain: 'Det finns ingen positionsuppgift, varken i ' + noun + ' eller från telefonen.' };
            }
            return { id: 'position', title: 'Position', state: 'info', items: withOther([{ state: 'info', text: 'Filen har ingen position. Telefonen registrerade ' + phone.length + (phone.length === 1 ? ' position' : ' positioner') + ' i fönstret, närmast ' + duration(near.offsetMs) + (near.offsetMs < 0 ? ' före' : ' efter') + ' ' + noun + '.' }]),
                plain: Noun + ' saknar positionsuppgift. Telefonen registrerade var den var ' + duration(near.offsetMs) + (near.offsetMs < 0 ? ' före' : ' efter') + (noun === 'filen' ? ' tidpunkten.' : ' att bilden togs.') };
        }
        var exifRow = pos.list.filter(function (p) { return p.kind === 'exif' && p.distanceM != null; })[0];
        // Sist i faktorn: var positionen kommer ifrån, när den inte är filens egen.
        var custom = !!(input.fileEntry && input.fileEntry.customLocation);
        var originNote = custom ? { state: 'info', text: 'Platsen är satt i efterhand i Bilder (com.apple.assetsd.customLocation på filen). Den visar inte var bilden togs.' }
            : input.platform === 'iOS' && input.exif && input.exif.read && !input.exif.position && !file.memory ? { state: 'info', text: 'Positionen finns i bildbiblioteket men inte i filen (ingen GPS i EXIF). Den kan ha lagts till i efterhand.' } : null;
        if (exifRow) items.push({ state: exifRow.distanceM <= 50 ? 'support' : 'contradiction', text: 'Positionen i EXIF i filen ligger ' + metres(exifRow.distanceM) + ' från positionen i databasen.' });
        var memRow = pos.list.filter(function (p) { return p.kind === 'memory'; })[0];
        if (memRow && memRow.distanceM != null) items.push({ state: memRow.distanceM <= 50 ? 'support' : 'contradiction', text: 'Positionen i Snapchats Memories ligger ' + metres(memRow.distanceM) + ' från positionen i databasen.' });
        else if (memRow) items.push({ state: 'info', text: 'Bildens position kommer ur Snapchats Memories (latitude, longitude), inte ur MediaStore, som saknar position för filen.' });
        if (!phone.length) {
            items.push({ state: 'missing', text: 'Telefonen har inga registrerade positioner i fönstret' + noPhoneLog + '.' });
            if (originNote) items.push(originNote);
            return { id: 'position', title: 'Position', state: memRow && !exifRow ? 'info' : 'missing', items: withOther(items), plain: memRow && !exifRow ? 'Snapchat sparade var bilden togs, men det finns ingen annan registrering av var telefonen var vid den tiden.' : 'Bilden har en position, men det finns ingen registrering av var telefonen var vid den tiden.' };
        }
        var tol = Math.max(100, 2 * (Number(near.accuracy) || 0));
        var when = duration(near.offsetMs) + (near.offsetMs < 0 ? ' före' : ' efter');
        var state;
        if (near.distanceM <= tol) { state = 'support'; items.push({ state: 'support', text: 'Telefonen var ' + metres(near.distanceM) + ' från bildens position ' + when + ' bilden (noggrannhet ' + Math.round(near.accuracy) + ' m).' }); }
        else if (near.distanceM > 1000) { state = 'contradiction'; items.push({ state: 'contradiction', text: 'Telefonen var ' + metres(near.distanceM) + ' från bildens position ' + when + ' bilden.' }); }
        else { state = 'info'; items.push({ state: 'info', text: 'Telefonen var ' + metres(near.distanceM) + ' från bildens position ' + when + ' bilden. Avståndet kan bero på GPS-fel.' }); }
        var within = phone.filter(function (p) { return p.distanceM <= Math.max(100, 2 * (Number(p.accuracy) || 0)); }).length;
        if (phone.length > 1) items.push({ state: 'info', text: within + ' av ' + phone.length + ' registrerade positioner i fönstret ligger inom noggrannheten från bildens position.' });
        if (originNote) items.push(originNote);
        // En plats som satts för hand säger inget om var bilden togs, så avståndet väger inte.
        if (custom && state !== 'info') { state = 'info'; items.forEach(function (it) { if (it.state !== 'info') it.state = 'info'; }); }
        var plain = custom ? 'Platsen är satt i efterhand i Bilder, så avståndet till telefonen säger inget om var bilden togs.'
            : state === 'support' ? 'Telefonen var på samma plats som bilden togs, ' + when + '.'
            : state === 'contradiction' ? 'Telefonen var ' + metres(near.distanceM) + ' från platsen där bilden ska ha tagits, ' + when + '. Det stämmer inte med att den här telefonen tog bilden där.'
                : 'Telefonen var ' + metres(near.distanceM) + ' från bildens position, ' + when + '. Så stora avstånd kan bero på GPS-fel.';
        return { id: 'position', title: 'Position', state: state, items: withOther(items), plain: plain };
    }

    // Intervallen som täcker ms (med tolerans), de som täcker utan tolerans först.
    function appsAt(events, ms, lane) {
        var edge = function (e) { return covers(e, ms, 0) ? 0 : Math.min(Math.abs(e.ms - ms), Math.abs((e.endMs != null ? e.endMs : e.ms) - ms)); };
        return events.filter(function (e) { return e.kind === 'app' && (!lane || e.lane === lane) && covers(e, ms); })
            .sort(function (a, b) { return edge(a) - edge(b) || a.ms - b.ms; });
    }

    function uniq(list) { var seen = {}; return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }

    // Tecken på att telefonen användes vid T utöver förgrundsloggen: en app som använde kameran
    // (appops) och en apps egna loggrader för åtgärder som görs i appen (händelser med active, till
    // exempel Signals logg när en bilaga sparas). Närmast T först.
    function activityAt(events, T) {
        var out = [];
        events.forEach(function (e) {
            if (e.kind === 'app' && e.cameraOp && covers(e, T, 0)) out.push({ app: e.app, camera: true, ms: e.ms, text: 'kameran användes', db: e.stream || 'appops' });
            else if (e.active && e.app && Math.abs(e.ms - T) <= TOLERANCE_MS) out.push({ app: e.app, camera: false, ms: e.ms, text: e.activeText || e.plain || e.text, db: e.source && e.source.db || '' });
        });
        return out.sort(function (a, b) { return Number(b.camera) - Number(a.camera) || Math.abs(a.ms - T) - Math.abs(b.ms - T); });
    }

    function factorApp(input, type, events) {
        var file = input.file;
        var T = file.createdMs;
        var names = input.appNames;
        var li = logInfo(input);
        var kcLabel = li.label;
        var streamKey = li.key;
        // Kameraanvändning ur appops är inte "app i förgrunden": appraden gäller förgrunden.
        var running = appsAt(events, T).filter(function (e) { return !e.cameraOp; });
        var runningNames = uniq(running.map(function (e) { return appName(e.app, names); }));
        var expected = type.type === 'camera' ? null : type.importer;
        var title = type.type === 'screenshot' ? 'App på skärmen' : 'App igång';
        // Kameraappen enligt katalogen, eller appen som enligt MediaStore skapade filen i DCIM/Camera.
        var camApp = function (e) { return isCameraApp(e.app, input.cameraApps) || (type.importer && e.app === type.importer); };
        // Använde kameraappen kameran vid T (appops) var den igång, även när förgrundsloggen saknas då.
        var camOps = type.type === 'camera' ? appsAt(events, T).filter(function (e) { return e.cameraOp && camApp(e) && covers(e, T, 0); }) : [];
        var anyInWindow = events.some(function (e) { return e.kind === 'app'; });
        var items = [];
        var state;
        var plain;
        var via = null;
        if (type.transfer) {
            var moved = type.transfer === 'airdrop' ? 'togs emot med AirDrop' : 'skapades i Bilder';
            return { id: 'app', title: title, state: 'na', items: [{ state: 'na', text: 'Filen ' + moved + ', så T är tiden från källan. Ingen app behöver ha varit igång då.' }], plain: 'Filen ' + moved + ', så frågan om vilken app som var igång vid T ställs inte.', running: [], via: null };
        }
        if (type.type === 'snapchat') {
            // Snapchats egen rad i registret vid T är ett tecken på att appen kördes, utöver knowledgeC.
            var own = events.filter(function (e) { return /^snap-/.test(e.kind) && Math.abs(e.ms - T) <= SAME_TIME_MS; }).sort(function (a, b) { return Math.abs(a.ms - T) - Math.abs(b.ms - T); });
            var kcSnap = running.filter(function (e) { return isSnapchatApp(e.app); });
            if (own.length) items.push({ state: 'support', text: 'Snapchat skrev själv i sitt register vid tidpunkten (' + own[0].source.db + ' → ' + own[0].source.table + '), vilket förutsätter att appen kördes.' });
            if (kcSnap.length) items.push({ state: 'support', text: 'Snapchat var igång vid tidpunkten enligt ' + kcLabel + ' (' + kcSnap[0].stream + ').' });
            else if (running.length) items.push({ state: 'info', text: kcLabel + ' registrerar ' + runningNames.join(', ') + ' vid tidpunkten, inte Snapchat. Snapchat kan ha skrivit i registret i bakgrunden, till exempel vid en notis.' });
            else items.push({ state: 'info', text: coverageReason(streamKey, input.coverage, input.missingDbs, T, kcLabel) });
            state = kcSnap.length ? 'support' : own.length ? (running.length ? 'info' : 'support') : 'missing';
            plain = state === 'support' ? 'Snapchat var igång när filen registrerades.'
                : state === 'info' ? 'Snapchat registrerade filen, men telefonens egen logg visar en annan app just då.'
                    : 'Det finns ingen registrering av att Snapchat var igång vid den här tiden.';
            return { id: 'app', title: 'Snapchat igång', state: state, items: items, plain: plain, running: running.map(function (e) { return e.app; }) };
        }
        if (!running.length && camOps.length) {
            state = 'support';
            items.push({ state: 'support', text: appName(camOps[0].app, names) + ' använde kameran vid tidpunkten (' + (camOps[0].stream === 'PowerLog' ? 'PowerLog' : 'appops') + '), så appen var igång.' });
            items.push({ state: 'info', text: 'Förgrundsloggen: ' + reasonAt(input, streamKey, T, kcLabel) });
            plain = 'Kameraappen använde kameran när bilden togs.';
            var via = { l1: appName(camOps[0].app, names) + ' använder kameran', l2: (camOps[0].stream === 'PowerLog' ? 'PowerLog' : 'appops') + ', ingen förgrundslogg' };
        } else if (!running.length && expected && activityAt(events, T).some(function (a) { return a.app === expected; })) {
            var act = activityAt(events, T).filter(function (a) { return a.app === expected; })[0];
            state = 'support';
            items.push({ state: 'support', text: appName(expected, names) + ' användes vid tidpunkten: ' + act.text + ' (' + act.db + ').' });
            items.push({ state: 'info', text: 'Förgrundsloggen: ' + reasonAt(input, streamKey, T, kcLabel) });
            plain = appName(expected, names) + ' användes när filen sparades.';
            via = { l1: appName(expected, names) + ': ' + act.text, l2: act.db + ', ingen förgrundslogg' };
        } else if (!running.length) {
            state = 'missing';
            var reason = anyInWindow ? 'Ingen app är registrerad som igång vid tidpunkten, men det finns registreringar i fönstret.' : reasonAt(input, streamKey, T, kcLabel);
            items.push({ state: 'missing', text: reason });
            plain = 'Det finns ingen registrering av vilken app som var öppen vid den här tiden. Det betyder inte att ingen app var öppen.';
        } else if (type.type === 'screenshot') {
            state = 'info';
            items.push({ state: 'info', text: 'På skärmen vid tidpunkten: ' + runningNames.join(', ') + ' (' + running[0].stream + ').' });
            plain = 'När skärmdumpen togs var ' + runningNames.join(' och ') + ' öppen på skärmen.';
        } else if (type.type === 'camera') {
            var cam = running.filter(camApp);
            if (cam.length) { state = 'support'; items.push({ state: 'support', text: (isCameraApp(cam[0].app, input.cameraApps) ? 'Kameran' : appName(cam[0].app, names) + ', som skapade filen,') + ' var igång vid tidpunkten (' + cam[0].stream + ').' }); }
            else { state = 'contradiction'; items.push({ state: 'contradiction', text: 'Vid tidpunkten var ' + runningNames.join(', ') + ' igång, inte kameran.' }); }
            var others = running.filter(function (e) { return !camApp(e) && covers(e, T, 0); });
            if (cam.length && others.length) items.push({ state: 'info', text: 'Samtidigt registrerades ' + others.map(function (e) { return appName(e.app, names); }).join(', ') + '.' });
            plain = state === 'support' ? 'Kameran var igång när bilden togs.' : 'Vid den här tiden var ' + runningNames.join(' och ') + ' igång, men inte kameran.';
        } else {
            var match = expected ? running.filter(function (e) { return e.app === expected; }) : [];
            var role = type.chat ? ', där filen ' + (type.chat.direction === 'in' ? 'togs emot' : 'skickades') + ',' : ', som skapade filen,';
            if (match.length) { state = 'support'; items.push({ state: 'support', text: appName(expected, names) + role + ' var igång vid tidpunkten (' + match[0].stream + ').' }); }
            else if (expected) { state = 'contradiction'; items.push({ state: 'contradiction', text: 'Vid tidpunkten var ' + runningNames.join(', ') + ' igång, inte ' + appName(expected, names) + (type.chat ? '' : ' som skapade filen') + '.' }); }
            else { state = 'info'; items.push({ state: 'info', text: 'Igång vid tidpunkten: ' + runningNames.join(', ') + '.' }); }
            plain = state === 'support' ? appName(expected, names) + ' var igång när ' + (type.chat ? 'filen ' + (type.chat.direction === 'in' ? 'togs emot' : 'skickades') : 'bilden sparades') + '.'
                : state === 'contradiction' ? 'Vid den här tiden var ' + runningNames.join(' och ') + ' igång, inte ' + appName(expected, names) + '.'
                    : 'Vid den här tiden var ' + runningNames.join(' och ') + ' igång.';
        }
        return { id: 'app', title: title, state: state, items: items, plain: plain, running: running.map(function (e) { return e.app; }), via: via || null };
    }

    // Meddelandet där filen togs emot i en chattapp, när filen inte också skickades från telefonen.
    function receivedIn(input) {
        var apps = [['Signal', input.signal], ['WhatsApp', input.whatsapp], ['Telegram', input.telegram]];
        for (var i = 0; i < apps.length; i++) {
            var ms = apps[i][1] && apps[i][1].link && apps[i][1].link.matches || [];
            var inn = ms.filter(function (m) { return m.direction === 'in'; });
            if (inn.length && inn.length === ms.length) return { app: apps[i][0], who: inn[0].who, messageId: inn[0].messageId };
        }
        return null;
    }

    function factorCamera(input, type, events, appFactor) {
        var file = input.file;
        var T = file.createdMs;
        var names = input.appNames;
        if (type.type === 'screenshot') {
            return { id: 'camera', title: 'Kamera igång', state: 'na', items: [{ state: 'na', text: 'En skärmdump tas utan kameran.' }], plain: 'Kameran behövs inte för en skärmdump, så den frågan ställs inte.' };
        }
        if (type.type === 'snapchat') return factorSnapchatCamera(input, type, events);
        if (type.chat) {
            var via = type.chat.direction === 'in' ? 'togs emot' : 'skickades';
            return { id: 'camera', title: 'Kamera igång', state: 'na', items: [{ state: 'na', text: 'Filen är ' + type.chat.appName + 's kopia av en fil som ' + via + ' i appen (meddelande ' + type.chat.messageId + '), så kameran frågas inte.' }],
                plain: 'Filen ' + via + ' i ' + type.chat.appName + ', så frågan om kameran ställs inte.' };
        }
        if (type.transfer) {
            var moved = type.transfer === 'airdrop' ? 'togs emot med AirDrop' : 'skapades i Bilder';
            return { id: 'camera', title: 'Kamera igång', state: 'na', items: [{ state: 'na', text: 'Filen ' + moved + ', så kameran på den här telefonen frågas inte.' }], plain: 'Filen ' + moved + ', så frågan om kameran ställs inte.' };
        }
        var gotIn = type.type === 'saved' ? receivedIn(input) : null;
        if (gotIn) {
            return { id: 'camera', title: 'Kamera igång', state: 'na', items: [{ state: 'na', text: 'Filen togs emot i ' + gotIn.app + ' från ' + gotIn.who + ' (meddelande ' + gotIn.messageId + '), så kameran på den här telefonen frågas inte.' }],
                plain: 'Filen togs emot i ' + gotIn.app + ', så frågan om kameran ställs inte.' };
        }
        var li = logInfo(input);
        // Android: tagningstiden enligt Snapchats Memories är då kameran måste ha varit igång; T är exporten.
        var tCam = file.capturedMs || T;
        var atCam = appsAt(events, tCam, 'camera');
        var ops = events.filter(function (e) { return e.kind === 'app' && e.cameraOp; });
        var whenText = file.capturedMs ? 'tagningstiden enligt Memories (' + formatUtc(file.capturedMs) + ')' : 'tidpunkten';
        // Appens egen kamera enligt appops (Android) eller PowerLog (iOS): igång vid T, eller stängd strax före.
        // PowerLogs tider får en mindre marginal än appops, så att en session som börjar strax efter T
        // inte räknas som igång vid T.
        var tolOf = function (e) { return e.stream === 'PowerLog' ? POWERLOG_TOL_MS : TOLERANCE_MS; };
        var importerCamera = function (app, creator) {
            var at = ops.filter(function (e) { return e.app === app && covers(e, tCam, tolOf(e)); });
            if (at.length) return { state: 'support', text: creator + ' använde kameran ' + formatUtc(at[0].ms) + ' till ' + formatUtc(at[0].endMs) + ' enligt ' + camSource(at[0]) + ', vilket täcker ' + whenText + '.',
                plain: creator + ' använde kameran när ' + (file.memory && file.memory.video ? 'videon spelades in' : 'bilden togs') + '.' };
            var before = ops.filter(function (e) { return e.app === app && e.endMs <= tCam + tolOf(e) && tCam - e.endMs <= 2 * MINUTE && !covers(e, tCam, tolOf(e)); });
            if (before.length) {
                var last = before[before.length - 1];
                return { state: 'info', text: creator + ' använde kameran ' + formatUtc(last.ms) + ' till ' + formatUtc(last.endMs) + ' enligt ' + camSource(last) + ', ' + duration(tCam - last.endMs) + ' före ' + whenText + '. Appen sparar filen när användaren väljer det, så kameran kan ha stängts innan.',
                    plain: creator + ' använde kameran ' + duration(tCam - last.endMs) + ' innan filen sparades.' };
            }
            return null;
        };
        var tgCam = type.type === 'saved' && type.importer === TELEGRAM && input.telegram && input.telegram.link ? input.telegram.link.camera : null;
        if (tgCam) return factorTelegramCamera(tgCam, importerCamera(TELEGRAM, 'Telegram'));
        if (type.type === 'saved' && type.importer && !isCameraApp(type.importer, input.cameraApps)) {
            var creator = appName(type.importer, names);
            // Appops (Android) och PowerLog (iOS) registrerar kameran per app, även en tredjepartsapps egen kamera.
            var own = importerCamera(type.importer, creator);
            if (own) return { id: 'camera', title: 'Kamera igång', state: own.state, items: [{ state: own.state, text: own.text }], plain: own.plain };
            if (ops.length) {
                var f0 = Object.assign({}, appFactor, { id: 'camera', title: 'Skaparappen igång' });
                f0.items = f0.items.concat([{ state: 'info', text: 'Ingen kameraanvändning av ' + creator + ' är registrerad i ' + (ops[0].stream === 'PowerLog' ? 'PowerLog' : 'appops') + ' kring ' + whenText + '. Filen kan ha tagits emot, valts ur galleriet eller skapats på annat sätt i appen.' }]);
                return f0;
            }
            // En tredjepartsapp med egen kamera ger inga rader för systemkameran.
            var f = Object.assign({}, appFactor, { id: 'camera', title: 'Skaparappen igång' });
            f.items = f.items.concat([{ state: 'info', text: 'Filen skapades av ' + creator + '. Har appen en egen kamera syns den inte som systemkameran i loggen. Därför bedöms om skaparappen var igång.' }]);
            return f;
        }
        var cam = atCam;
        var anyCamInWindow = events.some(function (e) { return e.kind === 'app' && e.lane === 'camera'; });
        var running = appsAt(events, tCam).filter(function (e) { return !e.cameraOp; });
        var kcLabel = li.label;
        var streamKey = li.key;
        if (cam.length) {
            // Varje källa för sig: knowledgeC (kameraappen i förgrunden) och PowerLog eller appops (kameran används).
            var camItems = [];
            cam.forEach(function (e) {
                if (camItems.some(function (it) { return it.stream === e.stream; })) return;
                var who = e.cameraOp && isCameraApp(e.app, input.cameraApps) ? 'Kameraappen' : appName(e.app, names);
                camItems.push({ stream: e.stream, state: 'support', text: who + (e.cameraOp ? ' använde kameran ' : ' var igång ') + formatUtc(e.ms) + ' till ' + formatUtc(e.endMs) + ' (' + (e.cameraOp ? camSource(e).replace(' (', ', ').replace(/\)$/, '') : e.stream) + ').' });
            });
            return { id: 'camera', title: 'Kamera igång', state: 'support', items: camItems.map(function (it) { return { state: it.state, text: it.text }; }),
                plain: 'Kameran var igång när bilden togs.' };
        }
        if (running.length) {
            return { id: 'camera', title: 'Kamera igång', state: 'contradiction', items: [{ state: 'contradiction', text: 'Kameran är inte registrerad vid tidpunkten. Igång var ' + uniq(running.map(function (e) { return appName(e.app, names); })).join(', ') + '.' }],
                plain: 'Kameran är inte registrerad som igång vid den här tiden. ' + uniq(running.map(function (e) { return appName(e.app, names); })).join(' och ') + ' var igång.' };
        }
        var reason = anyCamInWindow ? 'Kameran var igång i fönstret, men inte vid själva tidpunkten.' : reasonAt(input, streamKey, T, kcLabel);
        return { id: 'camera', title: 'Kamera igång', state: 'missing', items: [{ state: 'missing', text: reason }],
            plain: 'Det finns ingen registrering av om kameran var igång vid den här tiden. Det betyder inte att den inte var det.' };
    }

    // Telegrams kamera för en fil som Telegram sparat i bildbiblioteket: originalnamnet (camphoto_…,
    // camvideo_…) är det Telegrams kamera gav filerna i labbet, och samma fil (SHA-256) i Telegrams tmp/
    // binder. Utan filen i tmp/ är namnet en upplysning.
    // used: Telegrams kameraanvändning enligt PowerLog ({ state, text }) eller null.
    function factorTelegramCamera(c, used) {
        var what = c.video ? 'videon' : 'bilden';
        var items = used ? [{ state: used.state, text: used.text }] : [];
        if (c.same) {
            items.push({ state: 'support', text: 'Originalnamnet ' + c.name + ' är namnet Telegrams kamera ger ' + (c.video ? 'en video' : 'en bild') + ', och samma fil (SHA-256) ligger kvar i Telegrams behållare (' + c.path + ').' });
            return { id: 'camera', title: 'Telegrams kamera', state: 'support', items: items,
                plain: (c.video ? 'Videon spelades in' : 'Bilden togs') + ' med Telegrams kamera på den här telefonen.' };
        }
        items.push({ state: 'info', text: 'Originalnamnet ' + c.name + ' är namnet Telegrams kamera ger ' + (c.video ? 'en video' : 'en bild') + '. ' + (!c.path ? 'Filen finns inte kvar i Telegrams tmp/.' : c.same === false ? 'Filen ' + c.path + ' i Telegrams behållare har en annan SHA-256.' : 'Filen ' + c.path + ' finns i Telegrams behållare, men summorna kunde inte jämföras.') });
        if (used && used.state === 'support') {
            return { id: 'camera', title: 'Telegrams kamera', state: 'support', items: items, plain: (c.video ? 'Videon spelades in' : 'Bilden togs') + ' med Telegrams kamera på den här telefonen.' };
        }
        return { id: 'camera', title: 'Telegrams kamera', state: 'info', items: items,
            plain: 'Namnet tyder på att ' + what + ' kom från Telegrams kamera.' };
    }

    // Kameran för en fil i Snapchats cache: Snapchat använder sin egen kamera, så svaret kommer ur
    // cache_controller (typ 34 = inspelning) och arroyo (vem som skickade), inte ur knowledgeC.
    function factorSnapchatCamera(input, type, events) {
        var T = input.file.createdMs;
        var sc = input.file.snapchatCache || {};
        var title = 'Snapchats kamera';
        if (type.origin === 'recorded') {
            return { id: 'camera', title: title, state: 'support', items: [{ state: 'support', text: 'Registrerad som inspelning med Snapchats kamera (MEDIA_CONTEXT_TYPE 34' + (sc.recordingCopy ? ', och samma bytes finns i recorded_videos' : '') + ').' }],
                plain: 'Videon spelades in med Snapchats kamera på den här telefonen.' };
        }
        if (type.origin === 'received') {
            return { id: 'camera', title: title, state: 'na', items: [{ state: 'na', text: 'Filen kom via chatten från ' + (sc.who || 'ett annat konto') + ' enligt arroyo.db, så kameran på den här telefonen är inte inblandad.' }],
                plain: 'Filen togs emot i Snapchat från någon annan, så frågan om kameran gäller inte den här telefonen.' };
        }
        if (type.origin === 'sent') {
            var rec = events.filter(function (e) { return e.kind === 'snap-cache' && Number(e.context) === 34 && e.ms <= T + TOLERANCE_MS && T - e.ms <= 2 * MINUTE; });
            if (rec.length) {
                var last = rec[rec.length - 1];
                return { id: 'camera', title: title, state: 'support', items: [{ state: 'support', text: 'En inspelning med Snapchats kamera registrerades ' + duration(T - last.ms) + ' före filen (MEDIA_CONTEXT_TYPE 34, nyckel ' + String(last.cacheKey).slice(0, 12) + '…).' }],
                    plain: 'Snapchats kamera spelade in strax innan filen skickades.' };
            }
            return { id: 'camera', title: title, state: 'missing', items: [{ state: 'missing', text: 'Filen skickades från den här telefonen' + (type.recipient ? ' till @' + type.recipient : '') + ', men ingen inspelning med Snapchats kamera är registrerad strax före. En stillbild med Snapchats kamera ger inte alltid en inspelningspost, och filen kan också ha valts ur bildbiblioteket.' }],
                plain: 'Det syns inte om filen togs med Snapchats kamera eller valdes ur bildbiblioteket innan den skickades.' };
        }
        return { id: 'camera', title: title, state: 'missing', items: [{ state: 'missing', text: 'Snapchats register säger inte om kameran användes för den här filen' + (sc.context != null ? ' (typ ' + sc.context + ')' : '') + '.' }],
            plain: 'Det går inte att se om Snapchats kamera användes.' };
    }

    // Signal (beta): finns filen bland Signals bilagor (SHA-256 mot originalet före omkodningen och mot
    // den lagrade filen), valdes den i Signal enligt Signals logg, och sparades den ur Signal? input.signal
    // = { link, error, keySource } ur ProvenanceSignal.build. Läget beror på filens typ: för en fil som
    // Signal sparat stöder en träff hypotesen; för en kamerabild eller skärmdump är en mottagen bilaga
    // med samma innehåll inte förenlig med att filen kom från den här telefonen; en skickad är en upplysning.
    function factorSignal(input, type) {
        var s = input.signal || {};
        var title = 'Signal';
        var T = input.file.createdMs;
        var at = stamper(input);
        if (s.error) {
            return { id: 'signal', title: title, state: 'missing', items: [{ state: 'missing', text: s.error }],
                plain: 'Signals databas kunde inte läsas.', verdictText: 'Kunde inte läsas' };
        }
        var link = s.link || {};
        var ms = link.matches || [];
        var picks = (link.picks || []).filter(function (p) { return !p.discarded; });
        var recv = ms.filter(function (m) { return m.direction === 'in'; });
        var sent = ms.filter(function (m) { return m.direction === 'out'; });
        var items = [];
        recv.forEach(function (m) {
            items.push({ state: 'info', text: 'Mottagen från ' + m.who + ' ' + at(m.receivedMs) + ' (meddelande ' + m.messageId + (m.sentMs ? ', avsändarens klocka ' + at(m.sentMs) : '') + ')' + (m.viewOnce ? ', engångsvisning' : '') + (m.openedMs ? ', öppnad ' + at(m.openedMs) + ' (expireStartedAt)' : '') + '. Samma SHA-256 som bilagan.' });
        });
        sent.forEach(function (m) {
            items.push({ state: 'info', text: 'Skickad till ' + m.who + ' ' + at(m.sentMs) + ' (meddelande ' + m.messageId + ')' + (m.deleted ? ', raderad för alla senare' : '') + (m.linked ? ', skickad från en länkad enhet (wasNotCreatedLocally)' : '') + '. ' +
                (m.on === 'start' ? 'Filen är originalet; Signal skickade en omkodad kopia' + (m.width ? ' (' + m.width + '×' + m.height + ')' : '') + '.'
                    : m.on === 'name' ? 'Bilagan lades till med filens namn (' + m.fileName + '); Signal skickade en omkodad kopia' + (m.width ? ' (' + m.width + '×' + m.height + ')' : '') + '. Namnet binder svagare än en summa.'
                        : 'Samma SHA-256 som bilagan.') });
        });
        picks.forEach(function (p) {
            var tail = p.messageId == null && p.sentLater ? ', skickad ' + at(p.sentLater.ms) + ' (meddelande ' + p.sentLater.messageId + (p.deletedLater ? ', raderat ' + (p.deletedLater.forAll ? 'för alla ' : '') + at(p.deletedLater.ms) : '') + ')' : '';
            items.push({ state: 'info', text: 'Vald ' + (p.source === 'documents' ? 'med filväljaren' : 'ur galleriet') + ' i Signal ' + at(p.ms) + tail + ' (Signals logg).' });
        });
        if (link.saved) items.push({ state: 'info', text: 'Sparad till galleriet ' + at(link.saved.ms) + ' (Signals logg).' });
        if (link.nameTime) {
            items.push(link.nameMatch
                ? { state: 'info', text: 'Filnamnets tid ' + link.nameTime.slice(11) + ' är meddelandets (date_sent, avsändarens klocka).' }
                : { state: 'info', text: 'Filnamnets tid ' + link.nameTime + ' stämmer inte med något meddelande i vald tidszon.' });
        }
        var found = ms.length || picks.length;
        var none = 'Filens SHA-256 finns inte bland Signals ' + (link.attachments || 0) + ' bilagor.' +
            (link.platform === 'iOS' ? ' Signal kodar om bilder, så en bild ur bildbiblioteket som skickats har inte bilagans summa.' : '');
        var savedBySignal = type.importer === SIGNAL_ANDROID || type.importer === SIGNAL_IOS;
        if (savedBySignal) {
            if (recv.length || sent.length) {
                items.forEach(function (it) { it.state = 'support'; });
                var first = recv[0] || sent[0];
                return { id: 'signal', title: title, state: 'support', items: items, verdictText: recv.length ? 'Mottagen i Signal' : 'Skickad i Signal',
                    plain: recv.length ? 'Bilden togs emot i Signal från ' + first.who + ' ' + at(first.receivedMs) + ' och sparades till galleriet.' : 'Bilden skickades i Signal till ' + first.who + ' ' + at(first.sentMs) + ' och sparades till galleriet.' };
            }
            items.unshift({ state: 'missing', text: none + ' Meddelandet kan ha raderats.' });
            return { id: 'signal', title: title, state: 'missing', items: items, verdictText: 'Hittas inte', plain: 'Signal sparade filen, men bilagan finns inte kvar i Signal.' };
        }
        if (recv.length && !sent.length && !picks.length && (type.type === 'camera' || type.type === 'screenshot')) {
            items.forEach(function (it) { it.state = 'contradiction'; });
            return { id: 'signal', title: title, state: 'contradiction', items: items, verdictText: 'Togs emot i Signal',
                plain: 'Filen är samma bild som togs emot i Signal från ' + recv[0].who + ', inte en bild från telefonens ' + (type.type === 'screenshot' ? 'skärm' : 'kamera') + '.' };
        }
        if (found) {
            var lead = sent[0] || null;
            var after = lead && T ? (lead.sentMs >= T ? duration(lead.sentMs - T) + ' efter T' : at(lead.sentMs)) : '';
            return { id: 'signal', title: title, state: 'info', items: items, verdictText: 'Skickad i Signal',
                plain: lead ? 'Filen skickades i Signal till ' + lead.who + ', ' + after + '. ' + (picks.length ? 'Den valdes ur galleriet, så Signal skapade den inte.' : 'Det säger inget om hur den skapades.')
                    : 'Filen valdes i Signal enligt Signals logg, men meddelandet finns inte kvar.' };
        }
        if (link.platform === 'iOS') {
            return { id: 'signal', title: title, state: 'info', items: [{ state: 'info', text: none }], verdictText: 'Ingen koppling',
                plain: 'Ingen av Signals bilagor har filens SHA-256 eller namn. Signal kodar om bilder, så en bild som skickats ur bildbiblioteket känns inte igen på det sättet.' };
        }
        return { id: 'signal', title: title, state: 'info', items: [{ state: 'info', text: none }], verdictText: 'Inte i Signal', plain: 'Filen finns inte bland Signals bilagor.' };
    }

    // WhatsApp (beta, iOS): finns filen bland WhatsApps mediefiler (samma SHA-256, samma post i
    // bildbiblioteket eller filen själv under Message/), och vad hände med den? input.whatsapp = { link,
    // error } ur ProvenanceWhatsApp.build. En sparad kamerabild med ett skickat meddelande strax efter
    // är en möjlig koppling: bara tiden binder.
    function factorWhatsApp(input, type) {
        var w = input.whatsapp || {};
        var title = 'WhatsApp';
        var T = input.file.createdMs;
        var at = stamper(input);
        if (w.error) {
            return { id: 'whatsapp', title: title, state: 'missing', items: [{ state: 'missing', text: w.error }],
                plain: 'WhatsApps databas kunde inte läsas.', verdictText: 'Kunde inte läsas' };
        }
        var link = w.link || {};
        var ms = link.matches || [];
        var recv = ms.filter(function (m) { return m.direction === 'in'; });
        var sent = ms.filter(function (m) { return m.direction === 'out'; });
        var how = function (m) {
            var parts = [];
            if (m.by.indexOf('sha256') >= 0) parts.push('samma SHA-256 som mediefilen');
            if (m.by.indexOf('asset') >= 0) parts.push((m.direction === 'in' ? 'sparad i bildbiblioteket' : 'vald ur bildbiblioteket') + ' (samma post, ZUUID ' + m.assetUuid + ')');
            if (m.by.indexOf('path') >= 0) parts.push('filen är WhatsApps egen (' + m.path + ')');
            return parts.join(', ');
        };
        var items = [];
        recv.forEach(function (m) { items.push({ state: 'info', text: 'Mottagen från ' + m.who + ' ' + at(m.dateMs) + ' (meddelande ' + m.messageId + (m.viewOnce ? ', engångsvisning' : '') + '): ' + how(m) + '.' }); });
        sent.forEach(function (m) { items.push({ state: 'info', text: 'Skickad till ' + m.who + ' ' + at(m.sentMs != null ? m.sentMs : m.dateMs) + ' (meddelande ' + m.messageId + (m.viewOnce ? ', engångsvisning' : '') + '): ' + how(m) + '.' }); });
        var near = (link.nearby || [])[0] || null;
        var nearOwner = type.chatTemp ? 'Filen ligger i WhatsApps tillfälliga mapp.' : 'WhatsApp sparade filen.';
        var pending = link.pending ? ' ' + link.pending + (link.pending === 1 ? ' meddelande med media togs emot i bakgrunden men finns' : ' meddelanden med media togs emot i bakgrunden men finns') + ' inte i databasen (ServiceExtension-loggen), och filen kan höra till ' + (link.pending === 1 ? 'det' : 'något av dem') + '. Öppnas inte appen hamnar meddelandet inte i ChatStorage.sqlite.' : '';
        // WhatsApps egen fil under Message/: databasen säger vilket meddelande den hör till.
        var own = type.chat ? ms.find(function (m) { return m.by.indexOf('path') >= 0; }) : null;
        if (own) {
            items.forEach(function (it) { it.state = 'support'; });
            var ownMs = own.direction === 'in' ? own.dateMs : (own.sentMs != null ? own.sentMs : own.dateMs);
            return { id: 'whatsapp', title: title, state: 'support', items: items, verdictText: own.direction === 'in' ? 'Mottagen i WhatsApp' : 'Skickad i WhatsApp',
                plain: 'Filen är WhatsApps kopia i meddelande ' + own.messageId + ', ' + (own.direction === 'in' ? 'mottaget från ' : 'skickat till ') + own.who + ' ' + at(ownMs) + '.' };
        }
        var savedByWhatsApp = !type.chat && (type.importer === WHATSAPP || type.importer === WHATSAPP_BUSINESS);
        if (savedByWhatsApp && (recv.length || sent.length)) {
            items.forEach(function (it) { it.state = 'support'; });
            if (near) items.push({ state: 'info', text: 'En ' + near.kind + ' skickades också till ' + near.who + ' ' + at(near.sentMs) + ', ' + duration(near.afterMs) + ' efter att filen skapades (meddelande ' + near.messageId + '). Det kan vara samma bild, tagen med kameran. Bara tiden binder ihop dem.' });
            var first = recv[0] || sent[0];
            return { id: 'whatsapp', title: title, state: 'support', items: items, verdictText: recv.length ? 'Mottagen i WhatsApp' : 'Skickad i WhatsApp',
                plain: recv.length ? 'Filen togs emot i WhatsApp från ' + first.who + ' och sparades i bildbiblioteket.' : 'Filen skickades i WhatsApp till ' + first.who + ' och sparades i bildbiblioteket.' };
        }
        if (savedByWhatsApp && near) {
            return { id: 'whatsapp', title: title, state: 'info', verdictText: 'Möjlig koppling',
                items: [{ state: 'info', text: nearOwner + ' En ' + near.kind + ' skickades i WhatsApp till ' + near.who + ' ' + at(near.sentMs) + ', ' + duration(near.afterMs) + ' efter att filen skapades (meddelande ' + near.messageId + '). Bara tiden binder ihop dem: WhatsApp skickar en omkodad kopia och sparar ingen summa för originalet.' }],
                plain: nearOwner.slice(0, -1) + ', och en ' + near.kind + ' skickades i WhatsApp ' + duration(near.afterMs) + ' senare. Det kan vara samma bild; bara tiden binder ihop dem.' };
        }
        if (savedByWhatsApp && type.chatTemp) {
            return { id: 'whatsapp', title: title, state: 'info', verdictText: 'Inget meddelande',
                items: [{ state: 'info', text: 'Filen ligger i WhatsApps tillfälliga mapp (' + type.chatTemp.path + '), och inget meddelande med en bild skickades inom en minut. Bilden kan ha tagits med WhatsApps kamera utan att skickas, eller meddelandet kan ha raderats.' }],
                plain: 'Filen ligger i WhatsApps tillfälliga mapp, och inget meddelande skickades strax efter. Den kan ha tagits utan att skickas.' };
        }
        if (savedByWhatsApp) {
            return { id: 'whatsapp', title: title, state: 'missing', verdictText: 'Hittas inte',
                items: [{ state: 'missing', text: 'WhatsApp sparade filen, men varken summan eller bildbibliotekets post finns bland WhatsApps ' + (link.media || 0) + ' mediefiler, och inget meddelande med en bild skickades strax efter. Bilden kan ha tagits med WhatsApps kamera utan att skickas, eller meddelandet kan ha raderats.' + pending }],
                plain: 'WhatsApp sparade filen, men den hittas inte bland WhatsApps meddelanden.' };
        }
        if (recv.length && !sent.length && (type.type === 'camera' || type.type === 'screenshot')) {
            items.forEach(function (it) { it.state = 'contradiction'; });
            return { id: 'whatsapp', title: title, state: 'contradiction', items: items, verdictText: 'Togs emot i WhatsApp',
                plain: 'Filen är samma fil som togs emot i WhatsApp från ' + recv[0].who + ', inte en bild från telefonens ' + (type.type === 'screenshot' ? 'skärm' : 'kamera') + '.' };
        }
        if (sent.length) {
            var lead = sent[0];
            var leadMs = lead.sentMs != null ? lead.sentMs : lead.dateMs;
            var after = T ? (leadMs >= T ? duration(leadMs - T) + ' efter T' : at(leadMs)) : '';
            return { id: 'whatsapp', title: title, state: 'info', items: items, verdictText: 'Skickad i WhatsApp',
                plain: 'Filen skickades i WhatsApp till ' + lead.who + ', ' + after + '. ' + (lead.by.indexOf('asset') >= 0 ? 'Den valdes ur bildbiblioteket, så WhatsApp skapade den inte.' : 'Det säger inget om hur den skapades.') };
        }
        if (recv.length) {
            return { id: 'whatsapp', title: title, state: 'info', items: items, verdictText: 'Mottagen i WhatsApp', plain: 'Filen togs emot i WhatsApp från ' + recv[0].who + '.' };
        }
        return { id: 'whatsapp', title: title, state: 'info', verdictText: 'Inte i WhatsApp',
            items: [{ state: 'info', text: 'Filen finns inte bland WhatsApps ' + (link.media || 0) + ' mediefiler: varken samma SHA-256, samma post i bildbiblioteket eller samma sökväg.' + pending }],
            plain: 'Filen finns inte bland WhatsApps mediefiler.' };
    }

    // Telegram (beta, iOS): hör filen till ett meddelande i Telegram? Filen själv under postbox/media/,
    // en bild ur bildbiblioteket enligt lagringsdatabasen (ph-<ZUUID> med den uppladdade bildens storlek)
    // eller en bild som Telegram sparat med ett skickat meddelande strax efter (bara tiden binder).
    // input.telegram = { link, error } ur ProvenanceTelegram.build.
    function factorTelegram(input, type) {
        var t = input.telegram || {};
        var title = 'Telegram';
        var T = input.file.createdMs;
        var at = stamper(input);
        var after = function (ms) { return T ? (ms >= T ? duration(ms - T) + ' efter T' : at(ms)) : at(ms); };
        if (t.error) {
            return { id: 'telegram', title: title, state: 'missing', items: [{ state: 'missing', text: t.error }],
                plain: 'Telegrams databas kunde inte läsas.', verdictText: 'Kunde inte läsas' };
        }
        var link = t.link || {};
        var storageNote = link.storageRead ? '' : ' Telegrams lagringsdatabas finns inte i zippen, så val ur bildbiblioteket syns inte.';
        var savedBy = !type.chat && type.importer === TELEGRAM;
        // Telegrams egen fil under postbox/media/: resursen säger vilket meddelande den hör till.
        var own = type.chat && type.chat.app === TELEGRAM ? (link.matches || [])[0] || null : null;
        if (own) {
            var dir = own.direction === 'in' ? 'mottaget från ' : 'skickat till ';
            if (own.gone) {
                return { id: 'telegram', title: title, state: 'info', verdictText: 'Meddelandet finns inte kvar',
                    items: [{ state: 'info', text: 'Filen är Telegrams egen (' + own.path + '). Lagringsdatabasen säger att den hör till meddelande ' + own.messageId + ' i chatten ' + own.chat + ', men meddelandet finns inte kvar i t7.' }],
                    plain: 'Filen är Telegrams, men meddelandet den hörde till finns inte kvar.' };
            }
            return { id: 'telegram', title: title, state: 'support', verdictText: own.direction === 'in' ? 'Mottagen i Telegram' : 'Skickad i Telegram',
                items: [{ state: 'support', text: 'Filen är Telegrams egen (' + own.path + '): resursen i meddelande ' + own.messageId + ', ' + dir + own.who + ' ' + at(own.timeMs) + (own.viewOnce ? ', engångsvisning' : '') + '.' }],
                plain: 'Filen är Telegrams kopia i meddelande ' + own.messageId + ', ' + dir + own.who + ' ' + at(own.timeMs) + '.' };
        }
        var picks = link.picks || [];
        var sent = [];
        picks.forEach(function (p) { if (p.messages.length === 1) sent.push({ pick: p, m: p.messages[0] }); });
        var near = (link.nearby || [])[0] || null;
        var nearOwner = type.chatTemp ? 'Filen ligger i Telegrams tillfälliga mapp.' : 'Telegram sparade filen.';
        if (sent.length) {
            var lead = sent[0];
            var items = sent.map(function (x) {
                return { state: savedBy ? 'support' : 'info', text: 'Vald ur bildbiblioteket i Telegram och skickad till ' + x.m.who + ' ' + at(x.m.timeMs) + ' (meddelande ' + x.m.messageId + (x.m.viewOnce ? ', engångsvisning' : '') + '): lagringsdatabasen har bibliotekets id (' + x.pick.resourceId + '), och den uppladdade bilden är ' + x.pick.size + ' byte, lika stor som bilden i meddelandet.' };
            });
            if (savedBy && near) items.push({ state: 'info', text: 'En ' + near.kind + ' skickades också till ' + near.who + ' ' + at(near.timeMs) + ', ' + duration(near.afterMs) + ' efter att filen skapades (meddelande ' + near.messageId + '). Det kan vara samma ' + near.kind + ', tagen med kameran. Bara tiden binder ihop dem.' });
            return { id: 'telegram', title: title, state: savedBy ? 'support' : 'info', items: items, verdictText: 'Skickad i Telegram',
                plain: 'Filen valdes ur bildbiblioteket och skickades i Telegram till ' + lead.m.who + ', ' + after(lead.m.timeMs) + (lead.m.viewOnce ? ', för engångsvisning' : '') + '. ' + (savedBy ? '' : 'Det säger inget om hur den skapades.') };
        }
        if (picks.length) {
            var p0 = picks[0];
            var many = p0.messages.length > 1;
            return { id: 'telegram', title: title, state: 'info', verdictText: 'Vald i Telegram',
                items: [{ state: 'info', text: 'Telegram läste filen ur bildbiblioteket för chatten ' + (p0.chat || '') + ' (' + p0.resourceId + ', ' + (p0.size || 0) + ' byte). ' + (many ? p0.messages.length + ' meddelanden har en bild av samma storlek (' + p0.messages.map(function (m) { return m.messageId; }).join(', ') + '), så det går inte att säga vilket.' : 'Inget meddelande i chatten har en bild av samma storlek. Bilden kan ha skickats och raderats, eller valts utan att skickas.') }],
                plain: many ? 'Filen valdes ur bildbiblioteket i Telegram, men flera meddelanden passar.' : 'Filen valdes ur bildbiblioteket i Telegram, men meddelandet finns inte kvar.' };
        }
        if (savedBy && near) {
            return { id: 'telegram', title: title, state: 'info', verdictText: 'Möjlig koppling',
                items: [{ state: 'info', text: nearOwner + ' En ' + near.kind + ' skickades i Telegram till ' + near.who + ' ' + at(near.timeMs) + ', ' + duration(near.afterMs) + ' efter att filen skapades (meddelande ' + near.messageId + '). Bara tiden binder ihop dem: Telegram skickar en omkodad kopia.' }],
                plain: nearOwner.slice(0, -1) + ', och en ' + near.kind + ' skickades i Telegram ' + duration(near.afterMs) + ' senare. Det kan vara samma ' + near.kind + '; bara tiden binder ihop dem.' };
        }
        if (savedBy && type.chatTemp) {
            return { id: 'telegram', title: title, state: 'info', verdictText: 'Inget meddelande',
                items: [{ state: 'info', text: 'Filen ligger i Telegrams tillfälliga mapp (' + type.chatTemp.path + '), och inget meddelande med en ' + (link.camera && link.camera.video ? 'video' : 'bild') + ' skickades inom en minut. Den kan ha tagits med Telegrams kamera utan att skickas, eller meddelandet kan ha raderats.' }],
                plain: 'Filen ligger i Telegrams tillfälliga mapp, och inget meddelande skickades strax efter. Den kan ha tagits utan att skickas.' };
        }
        if (savedBy) {
            return { id: 'telegram', title: title, state: 'missing', verdictText: 'Hittas inte',
                items: [{ state: 'missing', text: 'Telegram sparade filen, men inget meddelande med en ' + (link.camera && link.camera.video ? 'video' : 'bild') + ' skickades i Telegram strax efter. Filen kan ha tagits emot, tagits med Telegrams kamera utan att skickas, eller meddelandet kan ha raderats.' + storageNote }],
                plain: 'Telegram sparade filen, men den hittas inte bland Telegrams meddelanden.' };
        }
        return { id: 'telegram', title: title, state: 'info', verdictText: 'Ingen koppling',
            items: [{ state: 'info', text: 'Varken filen själv, bildbibliotekets id i lagringsdatabasen eller ett meddelande pekar på filen bland Telegrams ' + (link.media || 0) + ' meddelanden med media.' + storageNote }],
            plain: 'Ingen av Telegrams poster pekar på filen. Telegram kodar om bilder, så en skickad bild känns bara igen på lagringsdatabasens post för bildbiblioteket, som kan saknas om cachen har tömts.' };
    }

    function factorScreen(input, events) {
        var T = input.file.createdMs;
        var on = events.filter(function (e) { return e.kind === 'screen' && covers(e, T); });
        if (!on.length) {
            var any = events.some(function (e) { return e.kind === 'screen'; });
            var li = logInfo(input);
            var reason = any ? 'Ingen registrering av skärmen vid själva tidpunkten.' : reasonAt(input, li.screenKey, T, li.label);
            // Kameravyn och åtgärder i en app kräver tänd skärm: då användes telefonen vid T.
            var act = activityAt(events, T)[0];
            if (act) {
                var who = appName(act.app, input.appNames);
                return { id: 'screen', title: 'Skärm', state: 'support',
                    items: [{ state: 'support', text: act.camera ? who + ' använde kameran vid tidpunkten (' + act.db + '). Kameravyn visas bara med tänd skärm.' : who + ' användes vid tidpunkten: ' + act.text + ' (' + act.db + '). Det görs med tänd skärm.' },
                        { state: 'info', text: 'Skärmloggen: ' + reason }],
                    plain: 'Skärmen var tänd: telefonen användes.', via: { l1: 'tänd enligt ' + (act.camera ? 'kameran' : who + (/log/i.test(act.db) ? 's logg' : 's databas')), l2: 'ingen skärmlogg vid T' } };
            }
            return { id: 'screen', title: 'Skärm', state: 'missing', items: [{ state: 'missing', text: reason }], plain: 'Det finns ingen registrering av om skärmen var tänd.' };
        }
        // Flera källor (knowledgeC och PowerLog på iOS) räknas var för sig. En källa räknar skärmen som tänd
        // om den var tänd inom marginalen kring T, som förut; en övergång nära T är alltså inte två lägen.
        // Säger källorna olika är det en upplysning.
        var litBy = uniq(on.filter(function (e) { return e.on; }).map(function (e) { return e.stream; }));
        var darkBy = uniq(on.filter(function (e) { return !e.on; }).map(function (e) { return e.stream; })).filter(function (st) { return litBy.indexOf(st) < 0; });
        // Låset: läget exakt vid T per källa, annars det närmaste inom marginalen.
        var lockNear = events.filter(function (e) { return e.kind === 'lock' && covers(e, T); });
        var lockAt = [];
        uniq(lockNear.map(function (e) { return e.stream; })).forEach(function (st) {
            var mine = lockNear.filter(function (e) { return e.stream === st; });
            lockAt.push(mine.filter(function (e) { return covers(e, T, 0); })[0] || mine[0]);
        });
        var lockedBy = lockAt.filter(function (e) { return e.locked; }).map(function (e) { return e.stream; });
        var openBy = lockAt.filter(function (e) { return !e.locked; }).map(function (e) { return e.stream; });
        var lockItem = lockedBy.length && openBy.length ? { state: 'info', text: 'Källorna säger olika om låset vid tidpunkten: låst enligt ' + lockedBy.join(', ') + ', olåst enligt ' + openBy.join(', ') + '.' }
            : lockAt.length ? { state: 'info', text: 'Telefonen var ' + (lockedBy.length ? 'låst' : 'olåst') + ' vid tidpunkten (' + (lockedBy.length ? lockedBy : openBy).join(', ') + '). Kameran går att starta från låsskärmen, så det avgör inget.' } : null;
        if (litBy.length && darkBy.length) {
            var mixed = [{ state: 'info', text: 'Källorna säger olika vid tidpunkten: skärmen tänd enligt ' + litBy.join(', ') + ', släckt enligt ' + darkBy.join(', ') + '. Kontrollera övergångarna i båda källorna.' }];
            if (lockItem) mixed.push(lockItem);
            return { id: 'screen', title: 'Skärm', state: 'info', items: mixed, plain: 'Källorna säger olika om skärmen var tänd vid den här tiden.' };
        }
        var lit = litBy.length > 0;
        var items = [{ state: lit ? 'support' : 'contradiction', text: (lit ? 'Skärmen var tänd vid tidpunkten (' : 'Skärmen var släckt vid tidpunkten (') + (lit ? litBy : darkBy).join(', ') + ').' }];
        if (lockItem) items.push(lockItem);
        var litLocked = lit && lockedBy.length && !openBy.length;
        if (litLocked) items.push({ state: 'info', text: 'Aviseringar tänder skärmen medan telefonen är låst (labbet), så en tänd skärm visar inte att någon använde telefonen.' });
        return { id: 'screen', title: 'Skärm', state: lit ? 'support' : 'contradiction', items: items,
            plain: litLocked ? 'Skärmen var tänd, men telefonen var låst. En avisering kan ha tänt den.' : lit ? 'Skärmen var tänd.' : 'Skärmen var släckt vid den här tiden, vilket inte stämmer med att någon använde telefonen då.' };
    }

    function alternatives(input, type, factors) {
        var file = input.file;
        var names = input.appNames;
        var out = [];
        var lateDiff = file.addedMs && file.createdMs ? file.addedMs - file.createdMs : null;
        var app = factors.find(function (f) { return f.id === 'app'; });
        var cam = factors.find(function (f) { return f.id === 'camera'; });

        function alt(id, label, fors, againsts) {
            out.push({ id: id, label: label, for: fors.filter(Boolean), against: againsts.filter(Boolean) });
        }
        var posF = factors.find(function (f) { return f.id === 'position'; });
        // För Snapchat-media är kamerafaktorn Snapchats egen registrering, inte kameraappen i loggen.
        var camText = cam && cam.state === 'support' ? (type.type === 'snapchat' ? 'Snapchats kamera användes för filen enligt Snapchats register.' : 'Kameran var igång vid tidpunkten.') : null;
        var copyAreas = {};
        (input.copies || []).forEach(function (c) { copyAreas[c.area] = c; });
        var mem = type.memory;
        var memText = mem && file.capturedMs ? 'Enligt Snapchats Memories ' + (mem.video ? 'spelades videon in' : 'togs bilden') + ' med telefonens ' + (mem.front ? 'frontkamera' : 'bakre kamera') + ' ' + formatUtc(file.capturedMs) + ' och sparades ' + duration(Math.abs((file.addedMs || file.createdMs) - mem.createdMs)) + ' innan filen lades till i galleriet.' : null;
        alt('received', 'Mottagen från någon annan (chatt, AirDrop, nedladdning)',
            [lateDiff != null && lateDiff > LATE_MS ? 'Filen lades till i biblioteket ' + duration(lateDiff) + ' efter att den skapades.' : null,
                type.type === 'saved' ? 'Skaparappen är ' + appName(type.importer, names) + '.' : null,
                type.origin === 'received' ? 'Filen kom via Snapchat-chatten från ' + (type.who || 'ett annat konto') + ' enligt arroyo.db.' : null,
                copyAreas.messages ? 'Exakt samma fil finns som bilaga i Meddelanden (' + copyAreas.messages.name + ').' : null,
                copyAreas.snapchat && type.type !== 'snapchat' ? 'Exakt samma fil finns i Snapchats lagring (' + copyAreas.snapchat.name + ').' : null,
                posF && posF.state === 'contradiction' ? posF.items.filter(function (i) { return i.state === 'contradiction'; }).map(function (i) { return i.text; }).join(' ') : null],
            [type.type === 'camera' ? 'Databasen anger kameran som källa (' + type.reasons.join(', ') + ').' : null,
                type.origin === 'recorded' ? 'Registrerad som inspelning med Snapchats kamera på den här telefonen.' : null,
                type.origin === 'sent' ? 'Filen skickades från den här telefonen' + (type.recipient ? ' till @' + type.recipient : '') + '.' : null,
                memText,
                lateDiff != null && Math.abs(lateDiff) <= SAME_TIME_MS && file.createdFrom !== 'date_added' ? 'Filen hamnade i biblioteket direkt när den skapades.' : null,
                type.origin === 'recorded' ? null : camText,
                posF && posF.state === 'support' ? 'Telefonen var på bildens position vid tidpunkten.' : null]);
        alt('synced', 'Synkad från en annan enhet eller molnet',
            [lateDiff != null && lateDiff > LATE_MS && type.type !== 'saved' ? 'Filen lades till i biblioteket långt efter att den skapades.' : null,
                file.cloudLocalState != null && Number(file.cloudLocalState) !== 0 ? 'ZCLOUDLOCALSTATE är ' + file.cloudLocalState + '.' : null],
            [type.type === 'snapchat' ? camText : cam && cam.state === 'support' ? 'Kameran var igång på den här telefonen vid tidpunkten.' : null,
                memText,
                lateDiff != null && Math.abs(lateDiff) <= SAME_TIME_MS && file.createdFrom !== 'date_added' ? 'Filen hamnade i biblioteket direkt när den skapades.' : null]);
        alt('screenshot', 'Skärmdump',
            [type.type === 'screenshot' ? type.reasons.join(', ') + '.' : null],
            [type.type !== 'screenshot' && type.reasons.length ? type.reasons.join(', ') + '.' : null]);
        alt('saved', 'Sparad eller skapad av en annan app än kameran',
            [type.type === 'saved' ? 'Skaparappen är ' + appName(type.importer, names) + '.' : null,
                type.type === 'snapchat' ? 'Filen ligger i Snapchats cache, inte i bildbiblioteket.' : null,
                app && app.state === 'contradiction' ? app.items[0].text : null],
            [type.type === 'camera' ? 'Databasen anger kameran som källa.' : null,
                camText]);
        alt('edited', 'Redigerad kopia',
            [file.editor ? 'Redigeringsappen är ' + appName(file.editor, names) + '.' : null],
            [!file.editor ? 'Ingen redigeringsapp är registrerad för filen.' : null]);
        return out;
    }

    // ---------- Förklaringen ----------

    function narrative(events, wins, opts) {
        opts = opts || {};
        var lines = [];
        var range = unionRange(wins);
        var seen = {};
        function push(ms, text, bold, e) {
            if (ms == null || text == null) return;
            if (!inRange(ms, range)) return;
            var key = Math.round(ms / 1000) + '|' + text;
            if (seen[key]) return;
            seen[key] = true;
            lines.push({ ms: ms, text: text, bold: !!bold, source: e && e.source || null, lane: e && e.lane || null, kind: e && e.kind || null, eventId: e && e.id || null });
        }
        var neighbours = [];
        var locations = [];
        events.forEach(function (e) {
            if (e.neighbour) { neighbours.push(e); return; }
            if (e.kind === 'location') { locations.push(e); return; }
            if (e.plain) push(e.ms, e.plain, e.bold, e);
            if (e.plainEnd && e.endMs != null && !e.openEnded) push(e.endMs, e.plainEnd, false, e);
        });
        lines.sort(function (a, b) { return a.ms - b.ms; });
        var notes = [];
        if (neighbours.length) {
            var T = opts.centerMs;
            var within = T != null ? Math.max.apply(null, neighbours.map(function (n) { return Math.abs(n.ms - T); })) : null;
            var span = within == null ? '' : within <= MINUTE ? ' inom en minut' : ' inom ' + Math.ceil(within / MINUTE) + ' minuter';
            // För en fil utanför biblioteket är grannarna bilderna i biblioteket runt tidpunkten.
            var what = opts.outside ? (neighbours.length === 1 ? ' bild i biblioteket skapades' : ' bilder i biblioteket skapades') : (neighbours.length === 1 ? ' bild till skapades' : ' bilder till skapades');
            notes.push(neighbours.length + what + span + (T != null ? (opts.outside ? ' från filen' : ' från bilden') : '') + '.');
        }
        if (locations.length) {
            var first = locations[0].ms, last = locations[locations.length - 1].ms;
            notes.push('Telefonen registrerade ' + locations.length + (locations.length === 1 ? ' position' : ' positioner') + (locations.length > 1 ? ' mellan ' + (opts.format || formatUtc)(first) + ' och ' + (opts.format || formatUtc)(last) : ' ' + (opts.format || formatUtc)(first)) + '.');
        }
        (opts.extraNotes || []).forEach(function (n) { notes.push(n); });
        return { lines: lines, notes: notes };
    }

    // ---------- Allt ihop ----------

    function build(input) {
        var file = input.file;
        var type = classify(file, input.platform, input);
        var wins = windows(file, input.windowMs);
        var built = buildEvents(input, type, wins);
        var events = built.events;
        var factors = [];
        var warnings = (input.warnings || []).slice();
        var pos = positions(input);
        if (file.createdMs) {
            var fTime = factorTime(input, type);
            var fApp = factorApp(input, type, events);
            var fCam = factorCamera(input, type, events, fApp);
            var fScreen = factorScreen(input, events);
            var fPos = factorPosition(input, pos, type, wins);
            factors = [fTime, fApp, fCam, fScreen, fPos];
            if (input.signal) factors.push(factorSignal(input, type));
            if (input.whatsapp) factors.push(factorWhatsApp(input, type));
            if (input.telegram) factors.push(factorTelegram(input, type));
        } else {
            factors = [factorTime(input, type)];
            warnings.push('Skapandetiden saknas, så app, kamera och skärm kan inte bedömas.');
        }
        var alts = file.createdMs ? alternatives(input, type, factors) : [];
        var perWindow = wins.map(function (w) {
            var n = narrative(events.filter(function (e) { return inRange(e.ms, w) || (e.endMs != null && e.endMs >= w.startMs && e.ms <= w.endMs); }), [w], { centerMs: w.centerMs, format: input.format, extraNotes: input.extraNotes, outside: type.type === 'snapchat' });
            // Raderna inom närbilden är nyckelhändelserna; resten visas när användaren ber om det.
            n.lines.forEach(function (l) { l.near = !!(w.closeup && l.ms >= w.closeup.startMs && l.ms <= w.closeup.endMs); });
            return { window: w, lines: n.lines, notes: n.notes };
        });
        var summary = summaryText(type, factors, input.appNames);
        var hyp = hypothesis(type, input.appNames);
        factors.forEach(function (f) { Object.assign(f, describeFactor(f, type, hyp)); });
        return {
            platform: input.platform, file: file, type: type, windows: wins, events: events, outside: built.outside,
            factors: factors, alternatives: alts, narrative: perWindow, warnings: warnings, summary: summary,
            positions: pos.list, filePosition: pos.filePos, copies: input.copies || [],
            beta: !!(type.snapchat || (input.extraEvents || []).length || input.signal || input.whatsapp || input.telegram),
            stateLabel: STATE_LABEL,
        };
    }

    // En mening som sammanfattar, alltid "förenligt"/"inte förenligt"/"går inte att bedöma".
    // Hypotesen som faktorerna prövas mot, i samma ord som sammanvägningen.
    function hypothesis(type, names) {
        return type.type === 'screenshot' ? 'att skärmdumpen togs på den här telefonen'
            : type.type === 'saved' && type.memory ? 'att ' + (type.memory.video ? 'videon spelades in' : 'bilden togs') + ' med Snapchats ' + (type.memory.front ? 'frontkamera' : 'bakre kamera') + ' på den här telefonen och sparades till galleriet'
            : type.type === 'saved' && type.chat ? (type.chat.direction === 'in' ? 'att filen togs emot i ' + type.chat.appName + ' på den här telefonen' + (type.chat.who ? ' från ' + type.chat.who : '') : 'att filen skickades från den här telefonen i ' + type.chat.appName)
            : type.transfer === 'airdrop' ? 'att filen togs emot med AirDrop på den här telefonen'
            : type.transfer === 'photos' ? 'att filen skapades i Bilder på den här telefonen'
            : type.chatTemp ? 'att filen skapades med ' + type.chatTemp.appName + ' på den här telefonen'
            : type.type === 'saved' ? 'att filen sparades på den här telefonen av ' + (type.importer ? appName(type.importer, names) : 'appen')
                : type.type === 'snapchat' ? (type.origin === 'recorded' || type.origin === 'sent' ? 'att filen skapades med Snapchat på den här telefonen'
                    : type.origin === 'received' ? 'att filen togs emot i Snapchat på den här telefonen' + (type.who ? ' från ' + type.who : '')
                        : 'att filen hanterades av Snapchat på den här telefonen')
                    : 'att bilden togs med den här telefonens kamera';
    }

    // Vad varje faktor frågar och svaret i klartext. Läget styr färgen; svaret är faktorns eget ord,
    // och meningen säger vad svaret betyder för hypotesen. Nycklarna är faktorernas rubriker.
    var FACTOR_WORDS = {
        'Skapandetid': { q: 'Stämmer filens egna tider med varandra: Skapad, Tillagd, tiden i bildfilen och filsystemets tid?', support: 'Tiderna stämmer', contradiction: 'Tiderna går isär', info: 'Kan inte jämföras', missing: 'Tid saknas' },
        'App igång': { q: 'Var appen som skapade filen igång vid T?', support: 'Appen var igång', contradiction: 'En annan app var igång', missing: 'Inte registrerat', na: 'Frågas inte' },
        'App på skärmen': { q: 'Vilken app var på skärmen när skärmdumpen togs?', missing: 'Inte registrerat' },
        'Snapchat igång': { q: 'Var Snapchat igång när filen skapades?', support: 'Snapchat var igång', contradiction: 'Snapchat var inte igång', missing: 'Inte registrerat' },
        'Kamera igång': { q: 'Användes kameran när bilden togs?', support: 'Kameran användes', contradiction: 'Kameran användes inte', missing: 'Inte registrerat', na: 'Frågas inte' },
        'Skaparappen igång': { q: 'Var appen som sparade filen igång när den sparades?', support: 'Appen var igång', contradiction: 'En annan app var igång', missing: 'Inte registrerat' },
        'Snapchats kamera': { q: 'Spelades filen in med Snapchats kamera på den här telefonen?', support: 'Snapchats kamera', missing: 'Inte registrerat', na: 'Frågas inte' },
        'Skärm': { q: 'Var skärmen tänd, alltså användes telefonen vid T?', support: 'Skärmen var tänd', contradiction: 'Skärmen var släckt', missing: 'Inte registrerat' },
        'Position': { q: 'Var telefonen där bilden säger att den togs?', support: 'Positionerna stämmer', contradiction: 'Positionerna går isär', missing: 'Position saknas' },
        'Signal': { q: 'Finns filen bland Signals bilagor, och vad hände med den i Signal?', support: 'Bilaga ur Signal', contradiction: 'Togs emot i Signal', info: 'Upplysning', missing: 'Hittas inte' },
        'Telegram': { q: 'Hör filen till ett meddelande i Telegram, och vad hände med den där?', support: 'Fil ur Telegram', contradiction: 'Togs emot i Telegram', info: 'Upplysning', missing: 'Hittas inte' },
        'Telegrams kamera': { q: 'Togs filen med Telegrams kamera på den här telefonen?', support: 'Telegrams kamera', info: 'Upplysning', missing: 'Inte registrerat' },
        'WhatsApp': { q: 'Finns filen bland WhatsApps mediefiler, och vad hände med den i WhatsApp?', support: 'Fil ur WhatsApp', contradiction: 'Togs emot i WhatsApp', info: 'Upplysning', missing: 'Hittas inte' },
    };

    function describeFactor(f, type, hyp) {
        var w = FACTOR_WORDS[f.title] || {};
        var q = w.q || '';
        if (f.id === 'app' && type.type === 'camera') q = 'Var kameraappen igång när bilden togs?';
        if (f.id === 'camera' && f.title === 'Kamera igång' && type.type === 'saved') q = 'Använde appen som sparade filen kameran när bilden togs?';
        return {
            question: q,
            verdict: f.verdictText || w[f.state] || STATE_LABEL[f.state] || f.state,
            meaning: f.state === 'support' ? 'Förenligt med ' + hyp + '.'
                : f.state === 'contradiction' ? 'Inte förenligt med ' + hyp + ' utan vidare.'
                    : f.state === 'missing' ? 'Registreringar saknas, så faktorn säger inget åt något håll.'
                        : f.state === 'na' ? 'Frågan gäller inte den här typen av fil.'
                            : 'En upplysning som inte väger åt något håll.',
        };
    }

    function summaryText(type, factors, names) {
        var core = factors.filter(function (f) { return f.id !== 'screen' && f.state !== 'na' && f.state !== 'info'; });
        var hyp = hypothesis(type, names);
        if (core.some(function (f) { return f.state === 'contradiction'; })) return 'Materialet är inte förenligt med ' + hyp + ' utan vidare: minst en faktor är inte förenlig med det.';
        var support = core.filter(function (f) { return f.state === 'support'; }).length;
        var missing = core.filter(function (f) { return f.state === 'missing'; }).length;
        if (support && !missing) return 'Materialet är förenligt med ' + hyp + '. Alla faktorer som gick att bedöma är förenliga med det.';
        if (support) return 'Materialet är förenligt med ' + hyp + ', men ' + missing + (missing === 1 ? ' faktor' : ' faktorer') + ' går inte att bedöma för att registreringar saknas.';
        return 'Det går inte att bedöma ' + hyp + ' utifrån det här materialet: registreringar saknas.';
    }

    // Flaggorna i klartext.
    var FLAG_LABELS = { edited: 'redigerad', 'received-later': 'tillagd långt efter att den skapades', trashed: 'i Raderade', hidden: 'dold' };
    function flagText(flags) { return (flags || []).map(function (f) { return FLAG_LABELS[f] || f; }).join(', '); }

    var api = {
        flagText: flagText, stamper: stamper,
        classify: classify, windows: windows, intervalsFromEvents: intervalsFromEvents, mergeIntervals: mergeIntervals,
        buildEvents: buildEvents, narrative: narrative, build: build, summaryText: summaryText, hypothesis: hypothesis, FACTOR_WORDS: FACTOR_WORDS,
        formatWithOffset: formatWithOffset, formatUtc: formatUtc, duration: duration, appName: appName, isCameraApp: isCameraApp, covers: covers,
        positions: positions, distanceM: distanceM, metres: metres, validCoord: validCoord, inWindows: inWindows, activityAt: activityAt,
        snapOrigin: snapOrigin, SNAPCHAT: SNAPCHAT, SNAPCHAT_ANDROID: SNAPCHAT_ANDROID, SIGNAL_ANDROID: SIGNAL_ANDROID, SIGNAL_IOS: SIGNAL_IOS, WHATSAPP: WHATSAPP, TELEGRAM: TELEGRAM, isSnapchatApp: isSnapchatApp, logInfo: logInfo, factorSignal: factorSignal, factorWhatsApp: factorWhatsApp, factorTelegram: factorTelegram, factorTelegramCamera: factorTelegramCamera,
        STATE_LABEL: STATE_LABEL, TOLERANCE_MS: TOLERANCE_MS, SAME_TIME_MS: SAME_TIME_MS, LATE_MS: LATE_MS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceCore = api;
})(typeof window !== 'undefined' ? window : this);
