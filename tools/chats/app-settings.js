// Appinställningar i Telefonen: vad WhatsApp, Signal och Snapchat har sparat om kontot, sekretessen, meddelandena,
// säkerhetskopian och länkade enheter. Här tolkas filer som redan är lästa ur zippen; script.js hittar och läser dem
// (för Signal med samma nyckel som chattarna). Testas i Node (app-settings.test.js).
//
// Varje rad har checked: true när den är kontrollerad i en labb (inställningen ändrades eller händelsen gjordes vid en
// loggad tid och syntes i filen), annars false: värdet står i filen, men vad det betyder är inte prövat. Telefonen märker
// de raderna, så att användaren ser att de inte är verifierade ännu.
//
// Kontrollerat mot (2026-11-20, nycklarnas namn och värden i labbarnas extraktioner):
//   WhatsApp Android  shared_prefs/com.whatsapp_preferences_light.xml, disappearing_mode_prefs.xml, backup_prefs.xml
//                     (Samsung A33, 2026-11-11)
//   WhatsApp iOS      AppGroup/…/Library/Preferences/group.net.whatsapp.WhatsApp.shared.plist (iPhone, 2026-11-11)
//   Signal Android    databases/signal-key-value.db, SQLCipher med databasnyckeln (OnePlus Nord, 2026-11-02)
//   Signal iOS        grdb/signal.sqlite: keyvalue och Device (iPhone, 2026-11-11; en macOS-dator länkad 2026-11-03,
//                     och meddelanden från den länkade enheten i labben 2026-11-05)
//   Snapchat          Spöksläget: databases/feature, ShareLocationPreferences (labbmobilen 2026-11-20: av, 3 timmar och
//                     tills det stängs av, med tiderna)
//   Snapchat          Spara till: core.db SnapchatUserProperties _id 24 (Android, labbet 2026-11-16) och
//                     primary.docobjects userproperties itemId 24 (iOS, labbet 2026-11-19), tools/provenance/snapchat.js
(function (root) {
    'use strict';

    var FILES = [
        { id: 'waPrefs', app: 'WhatsApp', platform: 'Android', re: /\/com\.whatsapp\/shared_prefs\/com\.whatsapp_preferences_light\.xml$/, label: 'com.whatsapp_preferences_light.xml' },
        { id: 'waDisappearing', app: 'WhatsApp', platform: 'Android', re: /\/com\.whatsapp\/shared_prefs\/disappearing_mode_prefs\.xml$/, label: 'disappearing_mode_prefs.xml' },
        { id: 'waBackup', app: 'WhatsApp', platform: 'Android', re: /\/com\.whatsapp\/shared_prefs\/backup_prefs\.xml$/, label: 'backup_prefs.xml' },
        { id: 'waIos', app: 'WhatsApp', platform: 'iOS', re: /\/Library\/Preferences\/group\.net\.whatsapp\.WhatsApp\.shared\.plist$/, label: 'group.net.whatsapp.WhatsApp.shared.plist' },
        { id: 'sigKv', app: 'Signal', platform: 'Android', re: /\/org\.thoughtcrime\.securesms\/databases\/signal-key-value\.db$/, sqlite: true, label: 'signal-key-value.db' },
        { id: 'snapCore', app: 'Snapchat', platform: 'Android', re: /\/com\.snapchat\.android\/databases\/core\.db$/, sqlite: true, label: 'core.db' },
        { id: 'snapFeature', app: 'Snapchat', platform: 'Android', re: /\/com\.snapchat\.android\/databases\/feature$/, sqlite: true, label: 'feature (Snapchat)' },
        { id: 'snapSession', app: 'Snapchat', platform: 'Android', re: /\/com\.snapchat\.android\/shared_prefs\/user_session_shared_pref\.xml$/, label: 'user_session_shared_pref.xml' },
        { id: 'snapDoc', app: 'Snapchat', platform: 'iOS', re: /\/DocObjects\/primary\.docobjects$/, sqlite: true, label: 'primary.docobjects' },
        { id: 'snapIos', app: 'Snapchat', platform: 'iOS', re: /\/Library\/Preferences\/com\.toyopagroup\.picaboo\.plist$/, label: 'com.toyopagroup.picaboo.plist' },
    ];

    function norm(name) { return '/' + String(name).replace(/\\/g, '/').replace(/^\/+/, ''); }

    // Vilken fil en post är, eller null. En -wal hör till sin databas.
    function fileOf(name) {
        var n = norm(name), wal = /-wal$/.test(n);
        if (wal) n = n.slice(0, -4);
        for (var i = 0; i < FILES.length; i++) if (FILES[i].re.test(n) && (!wal || FILES[i].sqlite)) return { id: FILES[i].id, wal: wal };
        return null;
    }
    // { id: { entry, wal } }: den kortaste sökvägen per fil (telefonens egen, inte en kopia djupare ned).
    function pick(entries) {
        var by = {}, wals = {};
        (entries || []).forEach(function (e) {
            var f = fileOf(e.name);
            if (!f) return;
            if (f.wal) { wals[e.name.slice(0, -4)] = e; return; }
            if (!by[f.id] || e.name.length < by[f.id].name.length) by[f.id] = e;
        });
        var out = {};
        Object.keys(by).forEach(function (id) { out[id] = { entry: by[id], wal: wals[by[id].name] || null }; });
        return out;
    }

    function utf8(bytes) {
        if (typeof bytes === 'string') return bytes;
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        return Buffer.from(bytes).toString('utf8');
    }
    function entities(s) {
        return String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (all, e) {
            var k = e.toLowerCase();
            if (k === 'lt') return '<';
            if (k === 'gt') return '>';
            if (k === 'amp') return '&';
            if (k === 'quot') return '"';
            if (k === 'apos') return "'";
            return String.fromCharCode(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
        });
    }

    // Androids shared_prefs: <map><boolean name value/><int …/><long …/><float …/><string name>text</string><set name>…</set>.
    // Som text eller ABX (abxParse). -> { namn: värde } med booleans, tal och text.
    function sharedPrefs(bytes, abxParse) {
        var out = {};
        if (!bytes || !bytes.length) return out;
        var typed = function (tag, v) {
            if (tag === 'boolean') return v === true || v === 'true';
            if (tag === 'int' || tag === 'long' || tag === 'float') { var n = Number(v); return isFinite(n) ? n : v; }
            return v === undefined || v === null ? '' : String(v);
        };
        if (bytes[0] === 0x41 && bytes[1] === 0x42 && bytes[2] === 0x58 && abxParse) {
            (function walk(el) {
                if (el.attrs && el.attrs.name !== undefined && el.name !== 'map') {
                    var v = el.attrs.value !== undefined ? el.attrs.value : (el.children || []).map(function (c) { return c.text || ''; }).join('');
                    out[String(el.attrs.name)] = typed(el.name, v);
                }
                (el.children || []).forEach(walk);
            })(abxParse(bytes));
            return out;
        }
        var text = utf8(bytes), re = /<(boolean|int|long|float|string|set)\s+name="([^"]*)"(?:\s+value="([^"]*)")?\s*(\/>|>([\s\S]*?)<\/\1>)/g, m;
        while ((m = re.exec(text))) {
            var name = entities(m[2]);
            if (m[1] === 'set') out[name] = (m[5] || '').split(/<string>/).slice(1).map(function (x) { return entities(x.replace(/<\/string>[\s\S]*$/, '')); });
            else out[name] = typed(m[1], m[3] !== undefined ? entities(m[3]) : entities(m[5] || ''));
        }
        return out;
    }

    // Ett värde ur NSKeyedArchiver (bplist med $objects och $top.root), annars texten.
    function keyedValue(bytes, parseBinary) {
        if (bytes === null || bytes === undefined) return null;
        if (typeof bytes === 'string' || typeof bytes === 'number') return bytes;
        if (!bytes.length) return null;
        var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (b.length > 8 && String.fromCharCode.apply(null, b.subarray(0, 6)) === 'bplist' && parseBinary) {
            var p = parseBinary(b);
            if (p && Array.isArray(p.$objects) && p.$top) {
                var r = p.$top.root !== undefined ? p.$top.root : p.$top[Object.keys(p.$top)[0]];
                var v = r && typeof r === 'object' && r.value !== undefined && !Array.isArray(r) ? p.$objects[r.value] : r;
                return v && typeof v === 'object' && v.value !== undefined && Object.keys(v).length === 1 ? p.$objects[v.value] : v;
            }
            return p;
        }
        return utf8(b);
    }

    // ---------- Raderna ----------

    function row(label, value, source, opts) {
        opts = opts || {};
        var r = { label: label, value: value === undefined || value === null ? '' : String(value), source: source || '', note: opts.note || '', checked: !!opts.checked };
        if (opts.on !== undefined) r.on = opts.on;
        if (opts.ms !== undefined) r.ms = opts.ms;
        return r;
    }
    function onOff(v) { return v ? 'På' : 'Av'; }
    function has(o, k) { return !!o && o[k] !== undefined && o[k] !== null && o[k] !== ''; }
    function secondsText(s) {
        s = Number(s);
        if (!s) return 'Av';
        var d = s / 86400;
        if (d >= 1 && d === Math.round(d)) return d === 1 ? '24 timmar' : d % 7 === 0 && d <= 28 ? (d === 7 ? '1 vecka' : d / 7 + ' veckor') + ' (' + d + ' dagar)' : d + ' dagar';
        if (s >= 3600) return Math.round(s / 3600) + ' timmar';
        if (s >= 60) return Math.round(s / 60) + ' minuter';
        return s + ' sekunder';
    }
    function utc(ms) { return ms === null || ms === undefined || !isFinite(ms) ? '' : new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'; }
    function timed(label, ms, source, opts) {
        ms = ms === null || ms === undefined || ms === '' ? null : Number(ms);
        if (!ms || !isFinite(ms) || ms <= 0) return null;
        return row(label, utc(ms), source, Object.assign({}, opts || {}, { ms: ms }));
    }
    function group(title, rows) { rows = rows.filter(Boolean); return rows.length ? { title: title, rows: rows } : null; }

    // WhatsApps sekretessval (0–3 i inställningarna, okontrollerat): som WhatsApps standardval stämmer 0 = Alla och
    // 1 = Mina kontakter i labbet.
    var WA_PRIVACY = { 0: 'Alla', 1: 'Mina kontakter', 2: 'Ingen', 3: 'Mina kontakter utom …', 4: 'Bara dela med …' };
    function waPrivacy(v) { return WA_PRIVACY[v] !== undefined ? WA_PRIVACY[v] : 'värde ' + v; }

    // WhatsApp på Android. p, dis och bk: shared_prefs som { namn: värde }.
    function whatsappAndroid(p, dis, bk) {
        p = p || {}; dis = dis || {}; bk = bk || {};
        var F = 'com.whatsapp_preferences_light.xml · ', D = 'disappearing_mode_prefs.xml · ', B = 'backup_prefs.xml · ';
        var privacy = [['privacy_last_seen', 'Senast sedd'], ['privacy_online', 'Online'], ['privacy_profile_photo', 'Profilbild'], ['privacy_status', 'Status'],
            ['privacy_groupadd', 'Grupper (vem som får lägga till)'], ['privacy_calladd', 'Samtal (vem som får ringa)'], ['privacy_profile_links', 'Länkar i profilen']];
        var groups = [
            group('Konto', [
                timed('Registrerad', p.registration_success_time_ms, F + 'registration_success_time_ms'),
                timed('Senast inloggad', has(p, 'last_login_time') ? Number(p.last_login_time) * 1000 : null, F + 'last_login_time', { note: 'Sekunder i filen.' }),
                has(p, 'app_install_source') ? row('Installerad från', String(p.app_install_source).split('|')[0], F + 'app_install_source') : null,
            ]),
            group('Sekretess', [has(p, 'read_receipts_enabled') ? row('Läskvitton', onOff(p.read_receipts_enabled), F + 'read_receipts_enabled', { on: !!p.read_receipts_enabled }) : null]
                .concat(privacy.map(function (x) { return has(p, x[0]) ? row(x[1], waPrivacy(p[x[0]]), F + x[0]) : null; }))),
            group('Meddelanden', [
                has(dis, 'disappearing_mode_duration_int') ? row('Försvinnande meddelanden (standard för nya chattar)', secondsText(dis.disappearing_mode_duration_int), D + 'disappearing_mode_duration_int', { on: Number(dis.disappearing_mode_duration_int) > 0 }) : null,
                timed('Standardtiden ändrad', dis.disappearing_mode_timestamp, D + 'disappearing_mode_timestamp'),
                has(p, 'input_enter_send') ? row('Enter skickar', onOff(p.input_enter_send), F + 'input_enter_send', { on: !!p.input_enter_send }) : null,
                has(p, 'archive_v2_enabled') ? row('Behåll chattar arkiverade', onOff(p.archive_v2_enabled), F + 'archive_v2_enabled', { on: !!p.archive_v2_enabled }) : null,
            ]),
            group('Platsdelning', [
                timed('Senaste delning startad', p.live_location_sharing_session_start_time, F + 'live_location_sharing_session_start_time'),
                timed('Senaste delning slutade', p.live_location_sharing_session_end_time, F + 'live_location_sharing_session_end_time'),
            ]),
            group('Säkerhetskopiering', [
                has(bk, 'gdrive_state') ? row('Google Drive', Number(bk.gdrive_state) === 0 ? 'Inte påslagen (0)' : 'Läge ' + bk.gdrive_state, B + 'gdrive_state', { on: Number(bk.gdrive_state) !== 0 }) : null,
                timed('Senast kontrollerad', bk.BACKUP_LAST_CHECK_TIMESTAMP, B + 'BACKUP_LAST_CHECK_TIMESTAMP'),
            ]),
            group('Länkade enheter', [has(p, 'md_messaging_enabled') ? row('Flera enheter (länkade enheter möjliga)', onOff(p.md_messaging_enabled), F + 'md_messaging_enabled', { on: !!p.md_messaging_enabled, note: 'Säger att kontot kan ha länkade enheter, inte att det har några.' }) : null]),
        ].filter(Boolean);
        return { app: 'WhatsApp', platform: 'Android', groups: groups };
    }

    // WhatsApp på iOS: group.net.whatsapp.WhatsApp.shared.plist. Många nycklar har förkortade namn; bara de tydliga läses.
    function whatsappIos(p, nsMs) {
        p = p || {};
        var F = 'group.net.whatsapp.WhatsApp.shared.plist · ';
        var ms = function (v) { return v && nsMs ? nsMs(v) : null; };
        var groups = [
            group('Konto', [
                has(p, 'FullUserName') ? row('Namn', p.FullUserName, F + 'FullUserName') : null,
                has(p, 'OwnPhoneNumber') ? row('Nummer', p.OwnPhoneNumber, F + 'OwnPhoneNumber') : null,
                has(p, 'CurrentStatusText') ? row('Om', p.CurrentStatusText, F + 'CurrentStatusText') : null,
                has(p, 'NumberOfLaunches') ? row('Antal starter', p.NumberOfLaunches, F + 'NumberOfLaunches') : null,
            ]),
            group('Sekretess', [has(p, 'ReadReceiptsOff') ? row('Läskvitton', onOff(!p.ReadReceiptsOff), F + 'ReadReceiptsOff', { on: !p.ReadReceiptsOff, note: 'Filen säger om läskvitton är avslagna.' }) : null]),
            group('Säkerhetskopiering', [
                timed('Senaste automatiska säkerhetskopiering (iCloud)', ms(p.lastAutoBackupDate), F + 'lastAutoBackupDate'),
                timed('AutoBackupCustom', ms(p.AutoBackupCustom), F + 'AutoBackupCustom', { note: 'En tid strax efter den automatiska säkerhetskopian i labbet; vad den står för är inte känt.' }),
                has(p, 'RestoreBackupDone') ? row('Återställd från säkerhetskopia', p.RestoreBackupDone ? 'Ja' : 'Nej', F + 'RestoreBackupDone', { on: !!p.RestoreBackupDone }) : null,
            ]),
        ].filter(Boolean);
        return { app: 'WhatsApp', platform: 'iOS', groups: groups };
    }

    // Signal på Android: raderna i signal-key-value.db (key_value: key, value, type). kv: { nyckel: värde }.
    function signalAndroid(kv) {
        kv = kv || {};
        var F = 'signal-key-value.db · ';
        var b = function (k, label, opts) { return has(kv, k) ? row(label, onOff(Number(kv[k]) === 1 || kv[k] === true), F + k, Object.assign({ on: Number(kv[k]) === 1 || kv[k] === true }, opts || {})) : null; };
        // Kontrollerat på labbmobilen 2026-11-20 (Signal på Android 13): inställningen ändrades i appen och filen lästes.
        var lab = { checked: true };
        // Androids PhoneNumberPrivacyValues: sharingMode 0 standard, 1 alla, 2 ingen; listingMode 0 listad, 1 olistad.
        var sharing = { 0: 'Standard', 1: 'Alla', 2: 'Ingen' }, listing = { 0: 'Alla', 1: 'Ingen' };
        var groups = [
            group('Konto', [
                timed('Registrerad', kv['account.registered_at'], F + 'account.registered_at', { checked: true, note: 'Labbet 2026-11-02: kontot registrerades om 18:38–18:47 och filen säger 18:46.' }),
                timed('Senast i förgrunden', kv['misc.last_foreground_time'], F + 'misc.last_foreground_time'),
            ]),
            group('Sekretess', [
                b('settings.read.receipts.enabled', 'Läskvitton', lab),
                b('settings.typing.indicators.enabled', 'Skrivindikator', lab),
                b('settings.link_previews', 'Förhandsvisning av länkar', lab),
                has(kv, 'phoneNumberPrivacy.sharingMode') ? row('Vem ser mitt nummer', sharing[kv['phoneNumberPrivacy.sharingMode']] || 'värde ' + kv['phoneNumberPrivacy.sharingMode'], F + 'phoneNumberPrivacy.sharingMode', lab) : null,
                has(kv, 'phoneNumberPrivacy.listingMode') ? row('Vem kan hitta mig med numret', listing[kv['phoneNumberPrivacy.listingMode']] || 'värde ' + kv['phoneNumberPrivacy.listingMode'], F + 'phoneNumberPrivacy.listingMode', lab) : null,
                b('settings.screen.lock.enabled', 'Skärmlås', { note: 'Inte kontrollerat: Signal kräver telefonens kod för att slå på skärmlåset.' }),
                b('settings.screen.security.enabled', 'Skärmskydd (inga skärmdumpar)', lab),
                b('settings.incognito.keyboard.enabled', 'Inkognitotangentbord', lab),
            ]),
            group('Meddelanden', [
                has(kv, 'settings.universal.expire.timer') ? row('Försvinnande meddelanden (standard för nya chattar)', secondsText(kv['settings.universal.expire.timer']), F + 'settings.universal.expire.timer', { on: Number(kv['settings.universal.expire.timer']) > 0, checked: true, note: 'Sekunder: 1 vecka är 604800 och 4 veckor 2419200 (labbmobilen 2026-11-20).' }) : null,
                has(kv, 'settings.message.notification.privacy') ? row('Notisernas innehåll', { all: 'Namn och meddelande', contact: 'Bara namn', none: 'Inget namn eller meddelande' }[kv['settings.message.notification.privacy']] || kv['settings.message.notification.privacy'], F + 'settings.message.notification.privacy') : null,
                b('stories.disable', 'Stories avstängda', lab),
            ]),
            group('Säkerhetskopiering', [b('settings.backups.enabled', 'Lokal säkerhetskopiering')]),
            group('Länkade enheter', [b('account.has_linked_devices', 'Har länkade enheter')]),
        ].filter(Boolean);
        return { app: 'Signal', platform: 'Android', groups: groups };
    }

    // Signal på iOS: keyvalue i signal.sqlite ({ collection, key, value }) och tabellen Device ({ deviceId, createdAt,
    // lastSeenAt, name }, sekunder). Enhet 1 är telefonen; de andra är länkade (kontrollerat i labbet: en macOS-dator).
    function signalIos(rows, devices, parseBinary) {
        var kv = {};
        (rows || []).forEach(function (r) { kv[r.collection + '|' + r.key] = r.value; });
        var get = function (c, k) { var v = kv[c + '|' + k]; return v === undefined ? undefined : keyedValue(v, parseBinary); };
        var F = 'signal.sqlite · keyvalue ';
        var bool = function (c, k, label, invert) {
            var v = get(c, k);
            if (v === undefined || v === null || typeof v === 'object') return null;
            var on = v === true || v === 1 || v === '1';
            if (invert) on = !on;
            return row(label, onOff(on), F + c + '/' + k, { on: on });
        };
        var reg = get('TSStorageUserAccountCollection', 'TSAccountManager_RegistrationDateKey');
        var sharing = get('kUDCollection', 'phoneNumberSharingMode');
        var sharingText = { 0: 'Alla', 1: 'Mina kontakter', 2: 'Ingen' };
        var devs = (devices || []).map(function (d) {
            var linked = Number(d.deviceId) !== 1;
            var name = d.name == null ? '' : String(d.name);
            return { id: Number(d.deviceId), linked: linked, name: linked ? (/^[\x20-\x7e]{1,40}$/.test(name) ? name : name ? 'krypterat namn' : '') : 'Den här telefonen',
                createdMs: d.createdAt ? Math.round(Number(d.createdAt) * 1000) : null, lastSeenMs: d.lastSeenAt ? Math.round(Number(d.lastSeenAt) * 1000) : null };
        });
        var linked = devs.filter(function (d) { return d.linked; });
        var groups = [
            group('Konto', [timed('Registrerad', reg != null && isFinite(Number(reg)) ? Math.round(Number(reg) * 1000) : null, F + 'TSStorageUserAccountCollection/TSAccountManager_RegistrationDateKey')]),
            group('Sekretess', [
                bool('OWSReadReceiptManagerCollection', 'areReadReceiptsEnabled', 'Läskvitton'),
                bool('StoryManager', 'areViewReceiptsEnabledKey', 'Visningskvitton för stories'),
                bool('TSStorageUserAccountCollection', 'TSAccountManager_IsDiscoverableByPhoneNumber', 'Kan hittas med numret'),
                typeof sharing === 'number' ? row('Vem ser mitt nummer', sharingText[sharing] || 'värde ' + sharing, F + 'kUDCollection/phoneNumberSharingMode') : null,
            ]),
            group('Länkade enheter', devs.length ? [row('Länkade enheter', linked.length ? String(linked.length) : 'Inga', 'signal.sqlite · Device', { checked: true, on: linked.length > 0, note: 'Enhet 1 är telefonen. Senast sedd är avrundad till dygnet.' })].concat(linked.map(function (d) {
                var r = row(d.name || 'Enhet ' + d.id, (d.createdMs ? 'länkad ' + utc(d.createdMs) : '') + (d.lastSeenMs ? (d.createdMs ? ' · ' : '') + 'senast sedd ' + utc(d.lastSeenMs).slice(0, 10) : ''), 'signal.sqlite · Device: deviceId ' + d.id + ', createdAt, lastSeenAt', { checked: true });
                // I vald zon: länkad med tiden, senast sedd som dygn (lastSeenAt är avrundad).
                if (d.createdMs) { r.ms = d.createdMs; r.prefix = 'länkad '; r.suffix = d.lastSeenMs ? ' · senast sedd ' + utc(d.lastSeenMs).slice(0, 10) : ''; }
                return r;
            })) : []),
        ].filter(Boolean);
        return { app: 'Signal', platform: 'iOS', groups: groups, devices: devs };
    }

    // Snapchats karta på Android: raden i ShareLocationPreferences (feature). Kontrollerat på labbmobilen 2026-11-20:
    // ghostModeEnabled 1/0, ghostModeExpiration slutet (3 timmar efter, eller 0 = tills det stängs av), version = när
    // läget senast ändrades (ms), audience FRIENDS när vännerna ser platsen. Andra värden på audience är inte prövade.
    var SNAP_AUDIENCE = { FRIENDS: 'Mina vänner' };
    function snapLocation(r) {
        if (!r) return [];
        var F = 'feature · ShareLocationPreferences: ', on = Number(r.ghostModeEnabled) === 1, exp = Number(r.ghostModeExpiration) || 0;
        return [
            row('Spöksläge', on ? 'På' : 'Av', F + 'ghostModeEnabled', { on: on, checked: true, note: 'Spöksläge på: vännerna ser inte platsen på Snap Map.' }),
            on ? (exp ? timed('Spökslägets slut', exp, F + 'ghostModeExpiration', { checked: true }) : row('Spökslägets slut', 'Tills det stängs av', F + 'ghostModeExpiration (0)', { checked: true })) : null,
            timed('Platsinställningen ändrad', r.version, F + 'version', { checked: true, note: 'Tiden för den senaste ändringen av spöksläget eller vem som ser platsen.' }),
            has(r, 'audience') ? row('Vem ser min plats', SNAP_AUDIENCE[r.audience] || (r.audience === 'NONE' ? 'Ingen' : String(r.audience)), F + 'audience', { checked: !!SNAP_AUDIENCE[r.audience],
                note: r.audience === 'NONE' ? 'NONE i filen (Samsungen i labbet 2026-11-11, med spöksläget på); inte prövat.' : '' }) : null,
            has(r, 'backgroundSharingEnabled') ? row('Plats i bakgrunden', onOff(Number(r.backgroundSharingEnabled) === 1), F + 'backgroundSharingEnabled', { on: Number(r.backgroundSharingEnabled) === 1 }) : null,
        ];
    }

    // Snapchat: inställningen Spara till (ProvenanceSnapchat.saveSetting, kontrollerad på båda plattformarna), spöksläget
    // (Android), användar-id och tiderna i appens egna inställningar.
    function snapchat(platform, save, session, ios, nsMs, location) {
        session = session || {}; ios = ios || {};
        var ms = function (v) { return v && typeof v === 'object' && nsMs ? nsMs(v) : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : null; };
        var saveRow = save ? row('Spara till', save.label.charAt(0).toUpperCase() + save.label.slice(1), platform === 'iOS' ? 'primary.docobjects · userproperties itemId 24' : 'core.db · SnapchatUserProperties _id 24 (textVal)',
            { checked: true, note: (save.copies ? 'Med kamerarullen lägger Snapchat en kopia av varje sparad snap i galleriet samma sekund. ' : '') + (save.changed === false ? 'Standardvärdet, aldrig ändrat (row_version 0).' : save.changed ? 'Ändrat från standardvärdet (row_version ' + save.version + ').' : '') }) : null;
        var savedAt = save && save.updatedMs ? timed('Spara till senast skriven', save.updatedMs, 'core.db · SnapchatUserProperties _id 24 (last_updated_time)', { checked: true }) : null;
        var groups = [
            group('Konto', platform === 'Android' ? [has(session, 'key_user_id') ? row('Användar-id', session.key_user_id, 'user_session_shared_pref.xml · key_user_id') : null] :
                [timed('Installerad första gången', ms(ios.user_first_install_date) || ms(ios.first_install_date), 'com.toyopagroup.picaboo.plist · ' + (ios.user_first_install_date ? 'user_first_install_date' : 'first_install_date'))]),
            group('Memories', [saveRow, savedAt]),
            group('Snap Map', snapLocation(location)),
        ].filter(Boolean);
        return { app: 'Snapchat', platform: platform, groups: groups };
    }

    // Antal rader och hur många som är kontrollerade i labb.
    function counts(s) {
        var n = 0, checked = 0;
        (s && s.groups || []).forEach(function (g) { g.rows.forEach(function (r) { n++; if (r.checked) checked++; }); });
        return { rows: n, checked: checked };
    }

    var api = { FILES: FILES, fileOf: fileOf, pick: pick, sharedPrefs: sharedPrefs, keyedValue: keyedValue, whatsappAndroid: whatsappAndroid, whatsappIos: whatsappIos,
        signalAndroid: signalAndroid, signalIos: signalIos, snapchat: snapchat, counts: counts, secondsText: secondsText, WA_PRIVACY: WA_PRIVACY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.AppSettings = api;
})(typeof window !== 'undefined' ? window : this);
