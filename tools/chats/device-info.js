// Telefonen: hemskärmen, bakgrunden och inställningarna ur extraktionen. Här tolkas filer som redan är lästa ur zippen
// (plist, Androids binära XML, text och rader ur SQLite). Inget här läser zippen eller ritar, så allt testas i Node;
// script.js hittar filerna, läser dem och ritar telefonen.
//
// Källorna, kontrollerade mot tre extraktioner 2026-11-19 (iPhone med iOS 26.4.1, Samsung A33 och Pixel 9a med
// Android 16):
//   iOS      SpringBoard/IconState.plist (hemskärmens sidor, mappar, widgetar och dockan, i telefonens ordning),
//            SystemVersion.plist, SystemConfiguration/preferences.plist (telefonens namn),
//            com.apple.wifi.known-networks.plist, Accounts3.sqlite, com.apple.commcenter.plist (nummer och SIM),
//            appens Info.plist i Bundle/Application/<GUID>/<App>.app (appens namn).
//   Android  com.sec.android.app.launcher/databases/OneUI.db (Samsung One UI), launcher*.db (Launcher3: Pixel och
//            andra), system/users/0/settings_global.xml, settings_secure.xml och settings_system.xml (ABX från
//            Android 12), wallpaper och wallpaper_lock (bakgrunden, en bildfil utan ändelse) med wallpaper_info.xml,
//            WifiConfigStore.xml, bluedroid/bt_config.conf, system_ce/0/accounts_ce.db, build.prop och launcherns
//            ikoncache app_icons.db (ikonerna som telefonen ritar), och notishistoriken i system_ce/0/notification_history.
//   iOS-notiserna är Biomes Notification.Usage (tools/provenance/biome.js): appen, titeln och tiden, inte texten.
// Bakgrunden på iOS 16 och senare ligger i PosterBoard som Apples egna texturer (.atx) och ritas inte.
(function (root) {
    'use strict';

    var node = typeof module !== 'undefined' && module.exports;

    // ---------- Filerna ----------

    // Filerna Telefonen läser, efter sökvägen i zippen. many: alla träffar behövs; skip: kopior som inte är telefonens
    // egen (programuppdateringar, säkerhetskopian av kontona). sqlite: -wal följer med.
    var FILES = [
        { id: 'iconState', platform: 'iOS', re: /\/mobile\/Library\/SpringBoard\/IconState\.plist$/, label: 'IconState.plist' },
        { id: 'systemVersion', platform: 'iOS', re: /\/System\/Library\/CoreServices\/SystemVersion\.plist$/, skip: /\/(MobileAsset|AssetsV2|\.AssetData)\//, label: 'SystemVersion.plist' },
        { id: 'netPrefs', platform: 'iOS', re: /\/preferences\/SystemConfiguration\/preferences\.plist$/, label: 'SystemConfiguration/preferences.plist' },
        { id: 'knownNetworks', platform: 'iOS', re: /\/preferences\/com\.apple\.wifi\.known-networks\.plist$/, label: 'com.apple.wifi.known-networks.plist' },
        { id: 'commcenter', platform: 'iOS', re: /\/wireless\/Library\/Preferences\/com\.apple\.commcenter\.plist$/, label: 'com.apple.commcenter.plist' },
        { id: 'accountsIos', platform: 'iOS', re: /\/mobile\/Library\/Accounts\/Accounts3\.sqlite$/, skip: /\/VerifiedBackup\//, sqlite: true, label: 'Accounts3.sqlite' },
        { id: 'appInfo', platform: 'iOS', re: /\/containers\/Bundle\/Application\/[0-9A-Fa-f-]{36}\/[^\/]+\.app\/Info\.plist$/, many: true, label: 'Info.plist' },
        { id: 'settingsGlobal', platform: 'Android', re: /\/system\/users\/0\/settings_global\.xml$/, label: 'settings_global.xml' },
        { id: 'settingsSecure', platform: 'Android', re: /\/system\/users\/0\/settings_secure\.xml$/, label: 'settings_secure.xml' },
        { id: 'settingsSystem', platform: 'Android', re: /\/system\/users\/0\/settings_system\.xml$/, label: 'settings_system.xml' },
        { id: 'wallpaper', platform: 'Android', re: /\/system\/users\/0\/wallpaper(_orig)?$/, many: true, label: 'wallpaper' },
        { id: 'wallpaperLock', platform: 'Android', re: /\/system\/users\/0\/wallpaper_lock(_orig)?$/, many: true, label: 'wallpaper_lock' },
        { id: 'wallpaperInfo', platform: 'Android', re: /\/system\/users\/0\/wallpaper_info\.xml$/, label: 'wallpaper_info.xml' },
        { id: 'wifiStore', platform: 'Android', re: /\/(?:misc|misc_ce\/0)\/(?:apexdata\/com\.android\.wifi|wifi)\/WifiConfigStore\.xml$/, many: true, label: 'WifiConfigStore.xml' },
        { id: 'btConfig', platform: 'Android', re: /\/misc\/bluedroid\/bt_config\.conf$/, label: 'bt_config.conf' },
        { id: 'accountsAndroid', platform: 'Android', re: /\/system_ce\/0\/accounts_ce\.db$/, sqlite: true, label: 'accounts_ce.db' },
        { id: 'buildProp', platform: 'Android', re: /^\/(?:[^\/]+\/)?(?:system(?:\/system)?|product\/etc|vendor|system_ext\/etc)\/build\.prop$/, many: true, label: 'build.prop' },
        { id: 'oneUi', platform: 'Android', re: /\/com\.sec\.android\.app\.launcher\/databases\/OneUI\.db$/, sqlite: true, label: 'OneUI.db' },
        { id: 'launcher3', platform: 'Android', re: /\/data\/(?:data|user\/0)\/[^\/]+\/databases\/launcher[^\/]*\.db$/, sqlite: true, many: true, label: 'launcher.db' },
        { id: 'notifHistory', platform: 'Android', re: /\/system_ce\/0\/notification_history\/history\/\d+$/, many: true, label: 'notification_history' },
        { id: 'biomeNotif', platform: 'iOS', re: /\/Biome\/streams\/restricted\/Notification\.Usage\/local\/\d+$/, many: true, label: 'Biome Notification.Usage' },
        { id: 'iconCache', platform: 'Android', re: /\/data\/(?:data|user\/0)\/[^\/]+\/databases\/app_icons\.db$/, sqlite: true, many: true, label: 'app_icons.db' },
        { id: 'appleNotes', platform: 'iOS', re: /\/Containers\/Shared\/AppGroup\/[0-9A-Fa-f-]{36}\/NoteStore\.sqlite$/, sqlite: true, label: 'NoteStore.sqlite' },
        { id: 'samsungNotes', platform: 'Android', re: /\/data\/(?:data|user\/0)\/com\.samsung\.android\.app\.notes\/databases\/sdoc\.db$/, sqlite: true, label: 'sdoc.db (Samsung Notes)' },
    ];
    var BY_ID = {};
    FILES.forEach(function (f) { BY_ID[f.id] = f; });

    function norm(name) { return '/' + String(name).replace(/\\/g, '/').replace(/^\/+/, ''); }

    // Vilken fil en post i zippen är, eller null. En -wal hör till sin databas.
    function fileOf(name) {
        var n = norm(name), wal = /-wal$/.test(n);
        if (wal) n = n.slice(0, -4);
        for (var i = 0; i < FILES.length; i++) {
            var f = FILES[i];
            if (f.re.test(n) && !(f.skip && f.skip.test(n)) && (!wal || f.sqlite)) return { id: f.id, wal: wal };
        }
        return null;
    }

    // Posterna sorterade per fil: { id: [{ entry, wal }] }. Av en fil som bara ska läsas en gång tas den med kortast
    // sökväg (telefonens egen, inte en kopia djupare ned). /data/user/0 är samma mapp som /data/data.
    function pick(entries) {
        var by = {}, wals = {};
        entries.forEach(function (e) {
            var f = fileOf(e.name);
            if (!f) return;
            if (f.wal) { wals[e.name.slice(0, -4)] = e; return; }
            (by[f.id] = by[f.id] || []).push(e);
        });
        var out = {};
        Object.keys(by).forEach(function (id) {
            var seen = {}, list = by[id].filter(function (e) {
                var k = norm(e.name).replace(/\/data\/user\/0\//, '/data/data/');
                if (seen[k]) return false;
                seen[k] = true;
                return true;
            }).sort(function (a, b) { return a.name.length - b.name.length || (a.name < b.name ? -1 : 1); });
            if (!BY_ID[id].many) list = list.slice(0, 1);
            out[id] = list.map(function (e) { return { entry: e, wal: wals[e.name] || null }; });
        });
        return out;
    }

    // ---------- Format ----------

    function utf8(bytes) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        return Buffer.from(bytes).toString('utf8');
    }
    function head(bytes, n) { var s = ''; for (var i = 0; i < Math.min(n, bytes.length); i++) s += String.fromCharCode(bytes[i]); return s; }
    function entities(s) {
        return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (all, e) {
            var k = e.toLowerCase();
            if (k === 'lt') return '<';
            if (k === 'gt') return '>';
            if (k === 'amp') return '&';
            if (k === 'quot') return '"';
            if (k === 'apos') return "'";
            return String.fromCharCode(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
        });
    }

    function base64(s) {
        if (typeof atob === 'function') { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
        return new Uint8Array(Buffer.from(s, 'base64'));
    }

    // En plist i XML. Datum blir { __nsdate: sekunder sedan 2001 } och data bytes, som i bplist.js.
    function xmlPlist(text) {
        var start = text.indexOf('<plist');
        if (start < 0) return null;
        var re = /<(\/)?([A-Za-z]+)[^>]*?(\/)?>|([^<]+)/g, tokens = [], m;
        re.lastIndex = text.indexOf('>', start) + 1;
        while ((m = re.exec(text))) {
            if (m[4] !== undefined) tokens.push({ t: 'text', v: m[4] });
            else if (m[2] !== 'plist') tokens.push({ t: m[1] ? 'close' : m[3] ? 'empty' : 'open', n: m[2] });
        }
        var p = 0;
        function blank() { while (p < tokens.length && tokens[p].t === 'text' && !tokens[p].v.trim()) p++; }
        function textOf(tag) {
            var s = '';
            while (p < tokens.length && !(tokens[p].t === 'close' && tokens[p].n === tag)) { if (tokens[p].t === 'text') s += tokens[p].v; p++; }
            p++;
            return entities(s);
        }
        function value() {
            blank();
            var tk = tokens[p++];
            if (!tk) return undefined;
            if (tk.t === 'empty') return tk.n === 'true' ? true : tk.n === 'false' ? false : tk.n === 'string' ? '' : tk.n === 'dict' ? {} : tk.n === 'array' ? [] : null;
            if (tk.t !== 'open') return undefined;
            if (tk.n === 'dict') {
                var o = {};
                for (;;) {
                    blank();
                    var k = tokens[p];
                    if (!k) return o;
                    if (k.t === 'close') { p++; return o; }
                    p++;
                    var key = k.n === 'key' && k.t === 'open' ? textOf('key') : '';
                    o[key] = value();
                }
            }
            if (tk.n === 'array') {
                var a = [];
                for (;;) {
                    blank();
                    if (!tokens[p]) return a;
                    if (tokens[p].t === 'close') { p++; return a; }
                    a.push(value());
                }
            }
            var s = textOf(tk.n);
            if (tk.n === 'integer' || tk.n === 'real') return Number(s.trim());
            if (tk.n === 'date') { var ms = Date.parse(s.trim()); return isFinite(ms) ? { __nsdate: ms / 1000 - 978307200 } : null; }
            if (tk.n === 'data') return base64(s.replace(/\s+/g, ''));
            return s;
        }
        return value();
    }

    // En plist, binär eller XML. parseBinary är KC.bplist.parse.
    function plist(bytes, parseBinary) {
        if (!bytes || bytes.length < 8) return null;
        if (head(bytes, 6) === 'bplist') return parseBinary ? parseBinary(bytes) : null;
        return xmlPlist(utf8(bytes));
    }

    // Cocoa-datum ur en plist i ms.
    function nsMs(v) {
        if (v && typeof v === 'object' && typeof v.__nsdate === 'number') return Math.round((v.__nsdate + 978307200) * 1000);
        return null;
    }

    // Bildens format efter de första byten, eller null.
    function imageType(bytes) {
        if (!bytes || bytes.length < 12) return null;
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (head(bytes, 4) === 'RIFF' && head(bytes.subarray(8, 12), 4) === 'WEBP') return 'image/webp';
        if (head(bytes, 3) === 'GIF') return 'image/gif';
        if (head(bytes.subarray(4, 8), 4) === 'ftyp') return 'image/heif';
        return null;
    }

    // Androids inställningar: { namn: värde } ur settings_*.xml, som ABX (Android 12 och senare, via abxParse) eller text.
    function settingsMap(bytes, abxParse) {
        var out = {};
        if (!bytes || !bytes.length) return out;
        if (head(bytes, 3) === 'ABX') {
            var walk = function (el) {
                if (el.name === 'setting' && el.attrs.name !== undefined) out[String(el.attrs.name)] = el.attrs.value === undefined || el.attrs.value === null ? null : String(el.attrs.value);
                el.children.forEach(walk);
            };
            walk(abxParse(bytes));
            return out;
        }
        var re = /<setting\b([^>]*)>/g, m;
        var text = utf8(bytes);
        while ((m = re.exec(text))) {
            var name = /\bname="([^"]*)"/.exec(m[1]), value = /\bvalue="([^"]*)"/.exec(m[1]);
            if (name) out[entities(name[1])] = value ? entities(value[1]) : null;
        }
        return out;
    }

    // Komponenten i wallpaper_info.xml: <wp> för hemskärmen och <kwp> för låsskärmen.
    function wallpaperInfo(bytes, abxParse) {
        var out = {};
        if (!bytes || !bytes.length) return out;
        if (head(bytes, 3) === 'ABX') {
            abxParse(bytes).children.forEach(function walk(el) {
                if (el.name === 'wp' || el.name === 'kwp') {
                    var d = el.children.filter(function (c) { return c.name === 'description' && c.attrs.component; })[0];
                    out[el.name === 'wp' ? 'home' : 'lock'] = d ? String(d.attrs.component) : el.attrs.component ? String(el.attrs.component) : '';
                }
                el.children.forEach(walk);
            });
            return out;
        }
        var text = utf8(bytes);
        [['wp', 'home'], ['kwp', 'lock']].forEach(function (t) {
            var m = new RegExp('<' + t[0] + '\\b[\\s\\S]*?component="([^"]*)"').exec(text);
            if (m) out[t[1]] = entities(m[1]);
        });
        return out;
    }

    // build.prop: { nyckel: värde } för alla filer, i den ordning de ges (de senare skriver inte över).
    function buildProps(texts) {
        var out = {};
        texts.forEach(function (t) {
            String(t).split(/\r?\n/).forEach(function (line) {
                var m = /^\s*([\w.\-]+)\s*=\s*(.*?)\s*$/.exec(line);
                if (m && !line.trim().startsWith('#') && out[m[1]] === undefined) out[m[1]] = m[2];
            });
        });
        return out;
    }

    // ---------- Appens namn ----------

    // Apples appar som inte står i App-ID:s katalog, med namnen på svenska.
    var IOS_NAMES = {
        'com.apple.mobilephone': 'Telefon', 'com.apple.MobileSMS': 'Meddelanden', 'com.apple.mobilesafari': 'Safari', 'com.apple.mobileslideshow': 'Bilder',
        'com.apple.camera': 'Kamera', 'com.apple.Preferences': 'Inställningar', 'com.apple.mobilemail': 'Mail', 'com.apple.mobilecal': 'Kalender',
        'com.apple.mobilenotes': 'Anteckningar', 'com.apple.reminders': 'Påminnelser', 'com.apple.mobiletimer': 'Klocka', 'com.apple.Maps': 'Kartor',
        'com.apple.weather': 'Väder', 'com.apple.AppStore': 'App Store', 'com.apple.Music': 'Musik', 'com.apple.facetime': 'FaceTime', 'com.apple.Health': 'Hälsa',
        'com.apple.Passbook': 'Plånbok', 'com.apple.tv': 'TV', 'com.apple.podcasts': 'Podcaster', 'com.apple.stocks': 'Aktier', 'com.apple.findmy': 'Hitta',
        'com.apple.Home': 'Hem', 'com.apple.iBooks': 'Böcker', 'com.apple.MobileStore': 'Apple Store', 'com.apple.Fitness': 'Fitness', 'com.apple.Bridge': 'Watch',
        'com.apple.MobileAddressBook': 'Kontakter', 'com.apple.DocumentsApp': 'Filer', 'com.apple.Translate': 'Översätt', 'com.apple.VoiceMemos': 'Röstmemon',
        'com.apple.compass': 'Kompass', 'com.apple.measure': 'Mätverktyg', 'com.apple.Magnifier': 'Förstoringsglas', 'com.apple.calculator': 'Kalkylator',
        'com.apple.shortcuts': 'Genvägar', 'com.apple.tips': 'Tips', 'com.apple.freeform': 'Freeform', 'com.apple.journal': 'Journal', 'com.apple.Passwords': 'Lösenord',
        'com.apple.supportapp': 'Support', 'com.apple.PreviewShell': 'Förhandsvisning', 'com.apple.games': 'Spel', 'com.apple.Image-Playground': 'Image Playground',
        'com.apple.mobileme.fmip1': 'Hitta iPhone', 'com.apple.mobilegarageband': 'GarageBand', 'com.apple.iMovie': 'iMovie', 'com.apple.Keynote': 'Keynote',
        'com.apple.Numbers': 'Numbers', 'com.apple.Pages': 'Pages', 'com.apple.clips': 'Clips', 'com.apple.Sidecar': 'Sidecar', 'com.apple.Diagnostics': 'Diagnostik',
    };

    // Namnet på en app: Apples egna appar med sina svenska namn (Info.plist har det engelska), annars Info.plist eller
    // launcherns titel, App-ID:s katalog, och sist id:t självt. names: { id: namn } ur extraktionen; catalog: App-ID:s APPS.
    // known: bara ett känt namn, annars tomt.
    function appName(id, names, catalog, known) {
        if (!id) return '';
        if (IOS_NAMES[id]) return IOS_NAMES[id];
        if (names && names[id]) return names[id];
        var c = (catalog || []).filter(function (a) { return (a.ios && a.ios.bundleId === id) || a.android === id; })[0];
        if (c) return c.name;
        if (known) return '';
        var parts = String(id).split('.');
        return parts[parts.length - 1] || String(id);
    }

    // Riktningstecken och nollbreda mellanrum (‎WhatsApp, Wallet​) syns inte i telefonen och tas bort.
    function clean(s) { return typeof s === 'string' ? s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '').trim() : ''; }

    // Info.plist i appens paket: { id, name }, eller null.
    function infoName(obj) {
        if (!obj || typeof obj.CFBundleIdentifier !== 'string') return null;
        var name = [obj.CFBundleDisplayName, obj.CFBundleName].map(clean).filter(Boolean)[0];
        return name ? { id: obj.CFBundleIdentifier, name: name } : null;
    }

    // Paketet i en Android-komponent ("com.whatsapp/.Main") eller ett intent ("…;component=pkg/cls;…" eller package=).
    function packageOf(s) {
        if (!s) return '';
        var str = String(s), m = /component=([^\/;]+)\//.exec(str) || /package=([^;]+);/.exec(str);
        if (m) return m[1];
        return /^[\w.]+\//.test(str) ? str.slice(0, str.indexOf('/')) : '';
    }

    // ---------- Hemskärmen ----------
    // Resultatet för alla tre: { source, platform, cols, rows, pages: [[{ x, y, w, h, item }]], dock: [item], unread }.
    // item: { kind: 'app', id, name } | { kind: 'folder', name, items: [app] } | { kind: 'widget', app, name, count }.

    // Platserna på en sida när bara ordningen är känd (iOS): widgetar och appar fylls i rad för rad, var och en på
    // den första plats där den får rum, som iOS gör när ingenting har flyttats. Platsen är alltså uträknad.
    function packPage(items, cols) {
        var used = [], out = [];
        function free(x, y, w, h) {
            if (x + w > cols) return false;
            for (var j = y; j < y + h; j++) for (var i = x; i < x + w; i++) if (used[j] && used[j][i]) return false;
            return true;
        }
        items.forEach(function (it) {
            var w = Math.min(it.w || 1, cols), h = it.h || 1;
            for (var y = 0; ; y++) {
                for (var x = 0; x + w <= cols; x++) {
                    if (free(x, y, w, h)) {
                        for (var j = y; j < y + h; j++) { used[j] = used[j] || []; for (var i = x; i < x + w; i++) used[j][i] = true; }
                        out.push({ x: x, y: y, w: w, h: h, item: it.item });
                        return;
                    }
                }
            }
        });
        return out;
    }

    var IOS_WIDGET = { small: [2, 2], medium: [4, 2], large: [4, 4], extraLarge: [4, 4] };

    // IconState.plist: iconLists är sidorna, buttonBar dockan. En sida har appar (bundle-id), mappar (en ordbok med
    // displayName och egna iconLists) och widgetar (elements, eller en ordbok med widgetIdentifier) med gridSize.
    function iosHome(obj, nameOf) {
        nameOf = nameOf || function (id) { return id; };
        var unread = 0;
        function app(id) { return { kind: 'app', id: id, name: nameOf(id) }; }
        function cell(el) {
            if (typeof el === 'string') return { w: 1, h: 1, item: app(el) };
            if (!el || typeof el !== 'object') { unread++; return null; }
            if (Array.isArray(el.iconLists)) {
                var items = [];
                el.iconLists.forEach(function (l) { (l || []).forEach(function (x) { if (typeof x === 'string') items.push(app(x)); }); });
                return { w: 1, h: 1, item: { kind: 'folder', name: String(el.displayName || 'Mapp'), items: items } };
            }
            var widgets = Array.isArray(el.elements) ? el.elements : el.widgetIdentifier || el.elementType === 'widget' ? [el] : null;
            if (widgets) {
                var size = IOS_WIDGET[el.gridSize] || IOS_WIDGET.small;
                var first = widgets[0] || {};
                var owner = String(first.containerBundleIdentifier || first.bundleIdentifier || first.widgetIdentifier || '');
                return { w: size[0], h: size[1], item: { kind: 'widget', app: owner, name: nameOf(owner), count: widgets.length, size: String(el.gridSize || 'small') } };
            }
            unread++;
            return null;
        }
        var pages = (Array.isArray(obj && obj.iconLists) ? obj.iconLists : []).map(function (list) {
            return packPage((list || []).map(cell).filter(Boolean), 4);
        });
        var dock = (Array.isArray(obj && obj.buttonBar) ? obj.buttonBar : []).map(cell).filter(Boolean).map(function (c) { return c.item; });
        return { source: 'IconState.plist', platform: 'iOS', cols: 4, rows: 6, pages: pages, dock: dock, unread: unread, computed: true };
    }

    function gridOf(pages, minCols, minRows) {
        var cols = minCols, rows = minRows;
        pages.forEach(function (p) { p.forEach(function (c) { cols = Math.max(cols, c.x + c.w); rows = Math.max(rows, c.y + c.h); }); });
        return { cols: cols, rows: rows };
    }
    function span(v) { v = Number(v); return v > 0 ? v : 1; }

    // OneUI.db (Samsung One UI 6 och senare): item_group har hemskärmen, dess sidor (page under workspace) och dockan
    // (hotseat). item har appar, mappar och widgetar; position_x och position_y är platsen på sidan, container_type 1
    // betyder att posten ligger i mappen container_id.
    function oneUiHome(items, groups) {
        var byId = {}, kids = {};
        groups.forEach(function (g) { byId[g.id] = g; kids[g.container_id] = (kids[g.container_id] || []).concat([g]); });
        var home = groups.filter(function (g) { return g.type === 'homescreen'; })[0];
        var under = home ? kids[home.id] || [] : [];
        var workspace = under.filter(function (g) { return g.type === 'workspace'; })[0];
        var hotseat = under.filter(function (g) { return g.type === 'hotseat'; })[0];
        var pageGroups = (workspace ? kids[workspace.id] || [] : []).filter(function (g) { return g.type === 'page'; })
            .sort(function (a, b) { return (a.rank || 0) - (b.rank || 0) || a.id - b.id; });
        var visible = items.filter(function (r) { return !Number(r.hidden); });
        function toItem(r) {
            var pkg = packageOf(r.component);
            if (r.type === 'folder') {
                var inside = visible.filter(function (c) { return Number(c.container_type) === 1 && c.container_id === r.id; })
                    .sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); })
                    .map(function (c) { return { kind: 'app', id: packageOf(c.component), name: String(c.title || packageOf(c.component)) }; });
                return { kind: 'folder', name: String(r.title || 'Mapp'), items: inside };
            }
            if (r.type === 'widget') return { kind: 'widget', app: pkg, name: '', count: 1, provider: String(r.component || '') };
            return { kind: 'app', id: pkg, name: String(r.title || pkg), icon: pngOf(r.icon) };
        }
        var pages = pageGroups.map(function (pg) {
            return visible.filter(function (r) { return Number(r.container_type) === 0 && r.container_id === pg.id; })
                .map(function (r) { return { x: Math.max(0, Number(r.position_x) || 0), y: Math.max(0, Number(r.position_y) || 0), w: span(r.spanX), h: span(r.spanY), item: toItem(r) }; })
                .sort(function (a, b) { return a.y - b.y || a.x - b.x; });
        });
        var dock = hotseat ? visible.filter(function (r) { return Number(r.container_type) === 0 && r.container_id === hotseat.id; })
            .sort(function (a, b) { return (Number(a.position_x) || 0) - (Number(b.position_x) || 0) || (a.rank || 0) - (b.rank || 0); }).map(toItem) : [];
        // Applådan (applist) har alla appar med namn, också de som inte ligger på hemskärmen.
        var drawer = {};
        items.forEach(function (r) { if (r.type === 'app' && r.title) drawer[packageOf(r.component)] = String(r.title); });
        var g = gridOf(pages, 4, 5);
        return { source: 'OneUI.db', platform: 'Android', cols: g.cols, rows: g.rows, pages: pages, dock: dock, unread: 0, names: drawer };
    }

    // launcher*.db (Launcher3, i Pixel och de flesta andra): favorites med container -100 (skrivbordet, sida screen),
    // -101 (dockan) eller id:t för mappen posten ligger i. itemType 0 app, 1 och 6 genväg, 2 mapp, 4 och 5 widget.
    // Rutnätet står i filnamnet (launcher_4_by_5.db) när det finns där.
    function launcher3Home(rows, fileName) {
        var m = /_(\d+)_by_(\d+)\.db$/.exec(String(fileName || ''));
        function toItem(r) {
            var t = Number(r.itemType);
            if (t === 2) {
                var inside = rows.filter(function (c) { return Number(c.container) === Number(r._id); })
                    .sort(function (a, b) { return (a.rank || 0) - (b.rank || 0) || (a.cellY || 0) - (b.cellY || 0) || (a.cellX || 0) - (b.cellX || 0); })
                    .map(function (c) { return { kind: 'app', id: packageOf(c.intent), name: String(c.title || packageOf(c.intent)) }; });
                return { kind: 'folder', name: String(r.title || 'Mapp'), items: inside };
            }
            if (t === 4 || t === 5) return { kind: 'widget', app: packageOf(r.appWidgetProvider), name: '', count: 1, provider: String(r.appWidgetProvider || '') };
            return { kind: 'app', id: packageOf(r.intent), name: String(r.title || packageOf(r.intent)), shortcut: t === 1 || t === 6, icon: pngOf(r.icon) };
        }
        var screens = [];
        rows.forEach(function (r) { if (Number(r.container) === -100 && screens.indexOf(Number(r.screen)) < 0) screens.push(Number(r.screen)); });
        screens.sort(function (a, b) { return a - b; });
        var pages = screens.map(function (s) {
            return rows.filter(function (r) { return Number(r.container) === -100 && Number(r.screen) === s; })
                .map(function (r) { return { x: Number(r.cellX) || 0, y: Number(r.cellY) || 0, w: span(r.spanX), h: span(r.spanY), item: toItem(r) }; })
                .sort(function (a, b) { return a.y - b.y || a.x - b.x; });
        });
        var dock = rows.filter(function (r) { return Number(r.container) === -101; })
            .sort(function (a, b) { return (Number(a.screen) || 0) - (Number(b.screen) || 0) || (Number(a.cellX) || 0) - (Number(b.cellX) || 0); }).map(toItem);
        var g = gridOf(pages, m ? Number(m[1]) : 4, m ? Number(m[2]) : 5);
        return { source: String(fileName || 'launcher.db').replace(/^.*\//, ''), platform: 'Android', cols: g.cols, rows: g.rows, pages: pages, dock: dock, unread: 0 };
    }

    // Namnet på en widget: appens, eller klassen i komponenten (com.sec.android.daemonapp/.appwidget.WeatherAppWidget2x1
    // blir WeatherAppWidget2x1) när appen inte har något känt namn.
    function widgetName(it, names, catalog) {
        var n = appName(it.app, names, catalog, true);
        if (n) return n;
        var cls = String(it.provider || '').split('/').pop().split('.').pop();
        return cls || appName(it.app, names, catalog);
    }

    // Ikonen som launchern sparade på raden (favorites.icon), när det är en bild.
    function pngOf(v) { return v instanceof Uint8Array && imageType(v) ? v : null; }

    // Launcherns ikoncache app_icons.db (tabellen icons i Launcher3, också hos Samsung): ikonen som telefonen ritar för
    // varje app, som PNG, med namnet (label). { paket: { icon, label, component } }, för huvudanvändaren (profileId 0).
    function iconCache(rows) {
        var out = {};
        rows.forEach(function (r) {
            var pkg = packageOf(r.componentName), icon = pngOf(r.icon);
            if (!pkg || !icon || (r.profileId !== undefined && r.profileId !== null && Number(r.profileId) !== 0)) return;
            if (!out[pkg]) out[pkg] = { icon: icon, label: r.label ? String(r.label) : '', component: String(r.componentName) };
        });
        return out;
    }

    // ---------- Notiserna ----------

    // Protobuf, så mycket som behövs: fälten på en nivå som [{ f, w, v }], där v är ett tal (varint) eller bytes.
    function protoFields(b) {
        var out = [], i = 0;
        function varint() {
            var v = 0, mul = 1, c;
            do { c = b[i++]; v += (c & 0x7f) * mul; mul *= 128; } while ((c & 0x80) && i < b.length);
            return v;
        }
        while (i < b.length) {
            var key = varint(), f = Math.floor(key / 8), w = key % 8;
            if (w === 0) out.push({ f: f, w: 0, v: varint() });
            else if (w === 2) { var n = varint(); out.push({ f: f, w: 2, v: b.subarray(i, i + n) }); i += n; }
            else if (w === 1) i += 8;
            else if (w === 5) i += 4;
            else throw new Error('protobuf: okänd typ ' + w + ' vid byte ' + i);
        }
        return out;
    }

    // Androids notishistorik (system_ce/<användare>/notification_history/history/<ms>, Android 11 och senare, när
    // Notishistorik är påslagen): NotificationHistoryProto med en strängpool (1), versionen (2) och en post per notis (3):
    // 1 paket, 3 kanalens namn, 5 kanalens id, 7 uid, 9 tiden i ms, 10 titeln, 11 texten, 13 konversationen; 2, 4, 6
    // och 14 är samma strängar som plats i poolen. Android sparar ungefär ett dygn. Kontrollerat mot Samsung A33
    // (Android 16), där strängarna stod direkt i posten och 15 var notisens nyckel; poolens platser är inte provade.
    function notificationHistory(bytes) {
        var top = protoFields(bytes), pool = [], out = [];
        top.filter(function (x) { return x.f === 1 && x.w === 2; }).forEach(function (x) {
            protoFields(x.v).forEach(function (y) { if (y.f === 2 && y.w === 2) pool.push(utf8(y.v)); });
        });
        var fromPool = function (n) { return n >= 1 && n <= pool.length ? pool[n - 1] : n >= 0 && n < pool.length ? pool[n] : ''; };
        top.filter(function (x) { return x.f === 3 && x.w === 2; }).forEach(function (x) {
            var n = {}, idx = {};
            protoFields(x.v).forEach(function (y) {
                if (y.w === 2 && y.f !== 12) n[y.f] = utf8(y.v);
                else if (y.w === 0) { n[y.f] = y.v; idx[y.f] = y.v; }
            });
            var str = function (f, i) { return typeof n[f] === 'string' ? n[f] : idx[i] !== undefined ? fromPool(idx[i]) : ''; };
            out.push({ app: str(1, 2), channel: str(3, 4), channelId: str(5, 6), uid: typeof n[7] === 'number' ? n[7] : null, ms: typeof n[9] === 'number' && n[9] > 0 ? n[9] : null,
                title: typeof n[10] === 'string' ? n[10] : '', text: typeof n[11] === 'string' ? n[11] : '', conversation: str(13, 14), key: typeof n[15] === 'string' ? n[15] : '' });
        });
        return out;
    }

    // Alla appar på hemskärmen, i mappar och i dockan: [{ id, name, where }].
    function homeAppIds(home) {
        var out = [];
        function add(it, where) {
            if (!it) return;
            if (it.kind === 'app') out.push({ id: it.id, name: it.name, where: where });
            else if (it.kind === 'folder') it.items.forEach(function (x) { out.push({ id: x.id, name: x.name, where: where + ', mappen ' + it.name }); });
        }
        home.pages.forEach(function (p, i) { p.forEach(function (c) { add(c.item, 'sida ' + (i + 1)); }); });
        home.dock.forEach(function (it) { add(it, 'dockan'); });
        return out;
    }

    // Vilken av Telefonens appar ett id är: en chattapp (namnet i Chattar), Bilder eller Inställningar.
    var APP_ROLE = {
        'net.whatsapp.WhatsApp': 'WhatsApp', 'com.whatsapp': 'WhatsApp',
        'org.whispersystems.signal': 'Signal', 'org.thoughtcrime.securesms': 'Signal',
        'ph.telegra.Telegraph': 'Telegram', 'org.telegram.messenger': 'Telegram', 'org.telegram.messenger.web': 'Telegram',
        'com.toyopagroup.picaboo': 'Snapchat', 'com.snapchat.android': 'Snapchat',
        'com.apple.mobileslideshow': 'Bilder', 'com.sec.android.gallery3d': 'Bilder', 'com.google.android.apps.photos': 'Bilder', 'com.android.gallery3d': 'Bilder',
        'com.oneplus.gallery': 'Bilder', 'com.miui.gallery': 'Bilder', 'com.coloros.gallery3d': 'Bilder', 'com.oppo.gallery3d': 'Bilder',
        'com.huawei.photos': 'Bilder', 'com.hihonor.photos': 'Bilder', 'com.vivo.gallery': 'Bilder', 'com.motorola.gallery': 'Bilder',
        'com.apple.Preferences': 'Inställningar', 'com.android.settings': 'Inställningar',
        'com.apple.mobilenotes': 'Anteckningar', 'com.samsung.android.app.notes': 'Anteckningar',
    };
    function roleOf(id) { return APP_ROLE[id] || ''; }

    // ---------- Inställningarna ----------
    // Varje del: { title, rows: [{ label, value, source, note }] }. source är filen och fältet.

    function row(label, value, source, note) { return { label: label, value: value === undefined || value === null ? '' : String(value), source: source || '', note: note || '' }; }
    function utc(ms) { return ms === null || ms === undefined || !isFinite(ms) ? '' : new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'; }
    function textOf(v) {
        if (v === undefined || v === null) return '';
        if (v instanceof Uint8Array) return utf8(v);
        return String(v);
    }

    // Om telefonen på iOS.
    function iosAbout(sys, prefs, comm) {
        var rows = [];
        var sysName = prefs && prefs.System && prefs.System.System;
        if (sysName && sysName.ComputerName) rows.push(row('Namn', sysName.ComputerName, 'preferences.plist · System/System/ComputerName'));
        if (sys) rows.push(row('Systemversion', [sys.ProductName === 'iPhone OS' ? 'iOS' : sys.ProductName, sys.ProductVersion, sys.ProductBuildVersion ? '(' + sys.ProductBuildVersion + ')' : ''].filter(Boolean).join(' '), 'SystemVersion.plist · ProductVersion, ProductBuildVersion'));
        if (comm) {
            if (comm.PhoneNumber) rows.push(row('Telefonnummer', '+' + String(comm.PhoneNumber).replace(/^\+/, ''), 'com.apple.commcenter.plist · PhoneNumber', 'Numret som SIM-kortet senast gav telefonen.'));
            if (comm.LastKnownICCID) rows.push(row('SIM (ICCID)', comm.LastKnownICCID, 'com.apple.commcenter.plist · LastKnownICCID'));
            if (comm.LastKnownServingMcc) rows.push(row('Senaste nät (MCC/MNC)', comm.LastKnownServingMcc + ' / ' + (comm.LastKnownServingMnc === undefined ? '?' : comm.LastKnownServingMnc), 'com.apple.commcenter.plist · LastKnownServingMcc, LastKnownServingMnc'));
        }
        return { id: 'about', title: 'Om telefonen', rows: rows };
    }

    // Kända Wi-Fi-nät på iOS: ett per nät, den senaste anslutningen först.
    function iosWifi(obj) {
        var out = [];
        Object.keys(obj || {}).forEach(function (k) {
            var n = obj[k];
            if (!n || typeof n !== 'object') return;
            var ssid = n.SSID instanceof Uint8Array ? utf8(n.SSID) : typeof n.SSID === 'string' ? n.SSID : k.replace(/^wifi\.network\.ssid\./, '');
            var last = null;
            (Array.isArray(n.BSSList) ? n.BSSList : []).forEach(function (b) { var t = nsMs(b && b.LastAssociatedAt); if (t !== null && (last === null || t > last)) last = t; });
            var joined = [nsMs(n.JoinedByUserAt), nsMs(n.JoinedBySystemAt)].filter(function (t) { return t !== null; });
            var lastJoin = joined.length ? Math.max.apply(null, joined) : null;
            out.push({ ssid: ssid, security: textOf(n.SupportedSecurityTypes), addedMs: nsMs(n.AddedAt), lastMs: last !== null ? last : lastJoin, userMs: nsMs(n.JoinedByUserAt), reason: textOf(n.AddReason), bundle: textOf(n.BundleID), hidden: n.Hidden === true });
        });
        out.sort(function (a, b) { return (b.lastMs || 0) - (a.lastMs || 0); });
        return out;
    }

    // Kända Wi-Fi-nät på Android ur WifiConfigStore.xml (text). Lösenordet visas inte, bara att det finns.
    function androidWifi(texts) {
        var out = [], seen = {};
        texts.forEach(function (text) {
            String(text).split('<Network>').slice(1).forEach(function (part) {
                var get = function (tag, name) {
                    var m = new RegExp('<' + tag + ' name="' + name + '"(?: value="([^"]*)")?\\s*/?>(?:([^<]*)</' + tag + '>)?').exec(part);
                    return m ? entities(m[1] !== undefined ? m[1] : m[2] || '') : null;
                };
                var ssid = (get('string', 'SSID') || '').replace(/^"|"$/g, '');
                var key = get('string', 'ConfigKey') || ssid;
                if (!ssid || seen[key]) return;
                seen[key] = true;
                var sec = /"(WPA_PSK|SAE|WPA_EAP|OWE|NONE|WEP)$/.exec(key.replace(/[^"]*"/, '"'));
                var created = get('long', 'CreationTime') || get('string', 'CreationTime');
                out.push({ ssid: ssid, security: sec ? sec[1].replace('WPA_PSK', 'WPA/WPA2 Personal').replace('SAE', 'WPA3 Personal').replace('NONE', 'Öppet') : '', hasKey: /<string name="PreSharedKey">/.test(part),
                    creator: get('string', 'CreatorName') || '', connected: get('boolean', 'HasEverConnected') === 'true', recent: get('boolean', 'IsMostRecentlyConnected') === 'true', createdText: created || '' });
            });
        });
        return out;
    }

    // Parkopplade Bluetooth-enheter i bt_config.conf: en del per adress med Name och Timestamp (Unix-sekunder).
    function androidBluetooth(text) {
        var sections = [], cur = null;
        String(text || '').split(/\r?\n/).forEach(function (line) {
            var s = /^\s*\[([^\]]+)\]\s*$/.exec(line);
            if (s) { cur = { name: s[1], keys: {} }; sections.push(cur); return; }
            var kv = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line);
            if (kv && cur) cur.keys[kv[1]] = kv[2];
        });
        var adapter = sections.filter(function (x) { return x.name === 'Adapter'; })[0];
        var devices = sections.filter(function (x) { return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(x.name); }).map(function (x) {
            var ts = Number(x.keys.Timestamp);
            return { address: x.name, name: x.keys.Name || x.keys.Aliase || '', paired: !!(x.keys.LinkKey || x.keys.LE_KEY_PENC), ms: ts > 0 ? ts * 1000 : null, type: { 1: 'Klassisk', 2: 'Bluetooth LE', 3: 'Båda' }[x.keys.DevType] || '' };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
        return { adapter: adapter ? { name: adapter.keys.Name || '', address: adapter.keys.Address || '' } : null, devices: devices };
    }

    // Om telefonen på Android.
    function androidAbout(props, global, secure) {
        var rows = [];
        var name = global.device_name || secure.bluetooth_name;
        if (name) rows.push(row('Namn', name, global.device_name ? 'settings_global.xml · device_name' : 'settings_secure.xml · bluetooth_name'));
        var model = props['ro.product.model'] || props['ro.product.product.model'] || props['ro.product.vendor.model'] || (props['ro.product.system.model'] !== 'mainline' ? props['ro.product.system.model'] : '');
        var brand = props['ro.product.brand'] || props['ro.product.product.brand'] || props['ro.product.vendor.brand'] || props['ro.product.system.brand'] || '';
        if (global.default_device_name) rows.push(row('Modellnamn', global.default_device_name, 'settings_global.xml · default_device_name'));
        if (model) rows.push(row('Modell', [brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : '', model].filter(Boolean).join(' '), 'build.prop · ro.product.model'));
        var release = props['ro.build.version.release'] || props['ro.system.build.version.release'];
        if (release) rows.push(row('Android-version', release, 'build.prop · ro.build.version.release'));
        if (props['ro.build.version.security_patch']) rows.push(row('Säkerhetsuppdatering', props['ro.build.version.security_patch'], 'build.prop · ro.build.version.security_patch'));
        if (props['ro.build.display.id']) rows.push(row('Byggnummer', props['ro.build.display.id'], 'build.prop · ro.build.display.id'));
        if (secure.android_id) rows.push(row('Android-id', secure.android_id, 'settings_secure.xml · android_id'));
        return { id: 'about', title: 'Om telefonen', rows: rows };
    }

    // Lägen ur Androids inställningar som syns i en riktig telefon. Bara det som har ett värde i filen.
    function androidToggles(global, secure, system) {
        var rows = [];
        var onOff = function (v) { return v === '1' ? 'På' : v === '0' ? 'Av' : v; };
        var add = function (label, map, file, key, fmt) { if (map[key] !== undefined && map[key] !== null) rows.push(row(label, (fmt || onOff)(map[key]), file + ' · ' + key)); };
        add('Flygplansläge', global, 'settings_global.xml', 'airplane_mode_on');
        add('Wi-Fi', global, 'settings_global.xml', 'wifi_on', function (v) { return v === '0' ? 'Av' : v === '1' ? 'På' : v === '2' ? 'På (flygplansläge)' : v === '3' ? 'Av (flygplansläge, sparat på)' : v; });
        add('Bluetooth', global, 'settings_global.xml', 'bluetooth_on');
        add('Mobildata', global, 'settings_global.xml', 'mobile_data');
        add('Dataroaming', global, 'settings_global.xml', 'data_roaming');
        add('Plats', secure, 'settings_secure.xml', 'location_mode', function (v) { return v === '0' ? 'Av' : v === '3' ? 'På (hög noggrannhet)' : v === '1' ? 'På (bara GPS)' : v === '2' ? 'På (sparar batteri)' : v; });
        add('Automatisk tid', global, 'settings_global.xml', 'auto_time');
        add('Automatisk tidszon', global, 'settings_global.xml', 'auto_time_zone');
        add('Utvecklaralternativ', global, 'settings_global.xml', 'development_settings_enabled');
        add('USB-felsökning', global, 'settings_global.xml', 'adb_enabled');
        add('Appar från okända källor', secure, 'settings_secure.xml', 'install_non_market_apps');
        add('Skärmen släcks efter', system, 'settings_system.xml', 'screen_off_timeout', function (v) { var s = Number(v) / 1000; return isFinite(s) ? (s >= 60 ? Math.round(s / 60) + ' min' : s + ' s') : v; });
        add('Textstorlek', system, 'settings_system.xml', 'font_scale', function (v) { return '× ' + v; });
        add('Antal starter', global, 'settings_global.xml', 'boot_count', function (v) { return v; });
        add('Tangentbord', secure, 'settings_secure.xml', 'default_input_method', function (v) { return String(v).split('/')[0]; });
        return { id: 'toggles', title: 'Lägen', rows: rows };
    }

    // Kontona: Accounts3.sqlite på iOS och accounts_ce.db på Android, ett per namn med sina slag.
    function accounts(rows, platform) {
        var by = {}, order = [];
        rows.forEach(function (r) {
            var user = r.user ? String(r.user) : '';
            var k = user || '(utan namn)';
            if (!by[k]) { by[k] = { user: user, kinds: [], firstMs: null }; order.push(k); }
            var kind = String(r.kind || r.type || '');
            if (kind && by[k].kinds.indexOf(kind) < 0) by[k].kinds.push(kind);
            if (typeof r.ms === 'number' && isFinite(r.ms) && (by[k].firstMs === null || r.ms < by[k].firstMs)) by[k].firstMs = r.ms;
        });
        return order.map(function (k) { return by[k]; }).sort(function (a, b) { return (a.user ? 0 : 1) - (b.user ? 0 : 1); });
    }

    var api = {
        FILES: FILES, fileOf: fileOf, pick: pick, xmlPlist: xmlPlist, plist: plist, nsMs: nsMs, imageType: imageType, settingsMap: settingsMap, wallpaperInfo: wallpaperInfo,
        buildProps: buildProps, appName: appName, infoName: infoName, packageOf: packageOf, packPage: packPage, iosHome: iosHome, oneUiHome: oneUiHome,
        launcher3Home: launcher3Home, homeAppIds: homeAppIds, widgetName: widgetName, iconCache: iconCache, protoFields: protoFields, notificationHistory: notificationHistory, clean: clean, roleOf: roleOf, iosAbout: iosAbout, iosWifi: iosWifi, androidWifi: androidWifi,
        androidBluetooth: androidBluetooth, androidAbout: androidAbout, androidToggles: androidToggles, accounts: accounts, utc: utc, row: row, IOS_NAMES: IOS_NAMES,
    };
    if (node) module.exports = api;
    else root.DeviceInfo = api;
})(typeof window !== 'undefined' ? window : this);
