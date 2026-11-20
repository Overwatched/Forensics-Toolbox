'use strict';
// Appinställningarna: shared_prefs, NSKeyedArchiver och raderna för WhatsApp, Signal och Snapchat. Värdena efterliknar
// labbarnas extraktioner (Samsung A33 och iPhone 2026-11-11, OnePlus Nord 2026-11-02).
const test = require('node:test');
const assert = require('node:assert');
const A = require('./app-settings.js');
require('../ios-keychain/lib/bplist.js');
const KC = globalThis.KC || globalThis.window.KC;
const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const rowsOf = (s) => Object.fromEntries(s.groups.flatMap((g) => g.rows.map((r) => [r.label, r])));

// En binär plist för NSKeyedArchiver med ett enda värde (sant, falskt eller ett heltal).
function keyed(value) {
    const objs = ['$null', value];
    const out = [];
    const offsets = [];
    const add = (bytes) => { offsets.push(8 + out.length); out.push(...bytes); };
    // Objekt: 0 top-ordbok, 1 värdet, 2 $objects-listan, 3 nyckeln root, 4 UID 1, 5 '$top', 6 '$objects', 7 '$null', 8 rotordbok.
    const str = (s) => [0x50 | s.length, ...Buffer.from(s, 'ascii')];
    const val = value === true ? [0x09] : value === false ? [0x08] : [0x10, value & 0xff];
    add([0xd2, 5, 6, 0, 2]);         // 0: { $top: obj0?, … } byggs nedan om
    add(val);                       // 1
    add([0xa2, 7, 1]);              // 2: [$null, värdet]
    add(str('root'));               // 3
    add([0x80, 1]);                 // 4: UID 1
    add(str('$top'));               // 5
    add(str('$objects'));           // 6
    add(str('$null'));              // 7
    add([0xd1, 3, 4]);              // 8: { root: UID 1 }
    // Rotordboken pekar på $top -> 8 och $objects -> 2.
    const rootAt = offsets[0] - 8;
    out[rootAt + 3] = 8; out[rootAt + 4] = 2;
    const body = Buffer.from(out);
    const table = Buffer.from(offsets);
    const trailer = Buffer.alloc(32);
    trailer[6] = 1; trailer[7] = 1;
    trailer.writeBigUInt64BE(BigInt(offsets.length), 8);
    trailer.writeBigUInt64BE(0n, 16);
    trailer.writeBigUInt64BE(BigInt(8 + body.length), 24);
    return new Uint8Array(Buffer.concat([Buffer.from('bplist00'), body, table, trailer]));
}

test('filerna känns igen på sökvägen, och en -wal hör till sin databas', () => {
    assert.deepStrictEqual(A.fileOf('Dump/data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml'), { id: 'waPrefs', wal: false });
    assert.deepStrictEqual(A.fileOf('Dump/data/data/org.thoughtcrime.securesms/databases/signal-key-value.db-wal'), { id: 'sigKv', wal: true });
    assert.deepStrictEqual(A.fileOf('filesystem1/private/var/mobile/Containers/Shared/AppGroup/0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0/Library/Preferences/group.net.whatsapp.WhatsApp.shared.plist'), { id: 'waIos', wal: false });
    assert.strictEqual(A.fileOf('Dump/data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences.xml'), null);
});

test('shared_prefs i text: booleans, tal, text med tecken och en mängd', () => {
    const p = A.sharedPrefs(enc("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <boolean name=\"read_receipts_enabled\" value=\"true\" />\n    <int name=\"privacy_last_seen\" value=\"1\" />\n" +
        '    <long name="registration_success_time_ms" value="1794401393626" />\n    <string name="app_install_source">google-play|unknown</string>\n    <string name="x">a &amp; b</string>\n    <set name="s">\n        <string>ett</string>\n        <string>två</string>\n    </set>\n</map>'));
    assert.deepStrictEqual(p, { read_receipts_enabled: true, privacy_last_seen: 1, registration_success_time_ms: 1794401393626, app_install_source: 'google-play|unknown', x: 'a & b', s: ['ett', 'två'] });
    assert.deepStrictEqual(A.sharedPrefs(new Uint8Array(0)), {});
});

test('NSKeyedArchiver: värdet under $top.root, och text och tal som de är', () => {
    assert.strictEqual(A.keyedValue(keyed(true), KC.bplist.parse), true);
    assert.strictEqual(A.keyedValue(keyed(false), KC.bplist.parse), false);
    assert.strictEqual(A.keyedValue(keyed(2), KC.bplist.parse), 2);
    assert.strictEqual(A.keyedValue(enc('1793703360.93293'), KC.bplist.parse), '1793703360.93293');
    assert.strictEqual(A.keyedValue(1793703360.93293, KC.bplist.parse), 1793703360.93293);
    assert.strictEqual(A.keyedValue(null), null);
});

test('WhatsApp på Android: sekretessen, försvinnande meddelanden, säkerhetskopian och flera enheter, inget kontrollerat i labb', () => {
    const s = A.whatsappAndroid({ read_receipts_enabled: true, privacy_last_seen: 1, privacy_online: 0, privacy_groupadd: 2, registration_success_time_ms: 1794401393626, last_login_time: 1794430493, md_messaging_enabled: true, app_install_source: 'google-play|unknown' },
        { disappearing_mode_duration_int: 604800, disappearing_mode_timestamp: 1794401400000 }, { gdrive_state: 0, BACKUP_LAST_CHECK_TIMESTAMP: 1794401861638 });
    const r = rowsOf(s);
    assert.strictEqual(s.app, 'WhatsApp');
    assert.strictEqual(r['Läskvitton'].value, 'På');
    assert.strictEqual(r['Läskvitton'].on, true);
    assert.strictEqual(r['Senast sedd'].value, 'Mina kontakter');
    assert.strictEqual(r['Online'].value, 'Alla');
    assert.strictEqual(r['Grupper (vem som får lägga till)'].value, 'Ingen');
    assert.strictEqual(r['Försvinnande meddelanden (standard för nya chattar)'].value, '7 dagar');
    assert.strictEqual(r['Senast inloggad'].ms, 1794430493000);
    assert.strictEqual(r['Installerad från'].value, 'google-play');
    assert.strictEqual(r['Google Drive'].value, 'Inte påslagen (0)');
    assert.ok(Object.values(r).every((x) => !x.checked));
    assert.deepStrictEqual(A.counts(s), { rows: Object.keys(r).length, checked: 0 });
});

test('WhatsApp på iOS: namn, läskvitton och iCloud-säkerhetskopian', () => {
    const nsMs = (v) => Math.round((v.__nsdate + 978307200) * 1000);
    const at = (iso) => ({ __nsdate: Date.parse(iso) / 1000 - 978307200 });
    const r = rowsOf(A.whatsappIos({ FullUserName: 'Labb', ReadReceiptsOff: false, lastAutoBackupDate: at('2026-11-03T11:12:08Z'), RestoreBackupDone: true, NumberOfLaunches: 4 }, nsMs));
    assert.strictEqual(r['Namn'].value, 'Labb');
    assert.strictEqual(r['Läskvitton'].value, 'På');
    assert.strictEqual(r['Senaste automatiska säkerhetskopiering (iCloud)'].ms, Date.parse('2026-11-03T11:12:08Z'));
    assert.strictEqual(r['Återställd från säkerhetskopia'].value, 'Ja');
});

test('Signal på Android: signal-key-value.db, med registreringen kontrollerad i labbet', () => {
    const r = rowsOf(A.signalAndroid({ 'account.registered_at': '1793641578753', 'settings.read.receipts.enabled': 1, 'settings.typing.indicators.enabled': 0, 'settings.universal.expire.timer': 86400,
        'phoneNumberPrivacy.sharingMode': 2, 'phoneNumberPrivacy.listingMode': 0, 'settings.screen.lock.enabled': 0, 'account.has_linked_devices': 1, 'settings.message.notification.privacy': 'contact' }));
    assert.strictEqual(r['Registrerad'].ms, 1793641578753);
    assert.strictEqual(r['Registrerad'].checked, true);
    assert.strictEqual(r['Läskvitton'].value, 'På');
    assert.strictEqual(r['Skrivindikator'].value, 'Av');
    assert.strictEqual(r['Försvinnande meddelanden (standard för nya chattar)'].value, '24 timmar');
    assert.strictEqual(r['Vem ser mitt nummer'].value, 'Ingen');
    assert.strictEqual(r['Vem kan hitta mig med numret'].value, 'Alla');
    assert.strictEqual(r['Har länkade enheter'].on, true);
    assert.strictEqual(r['Notisernas innehåll'].value, 'Bara namn');
    assert.strictEqual(r['Har länkade enheter'].checked, false);
});

test('Signal på iOS: keyvalue som arkiv, text och tal, och den länkade datorn ur Device, kontrollerad i labb', () => {
    const rows = [
        { collection: 'OWSReadReceiptManagerCollection', key: 'areReadReceiptsEnabled', value: keyed(true) },
        { collection: 'kUDCollection', key: 'phoneNumberSharingMode', value: keyed(2) },
        { collection: 'TSStorageUserAccountCollection', key: 'TSAccountManager_IsDiscoverableByPhoneNumber', value: 1 },
        { collection: 'TSStorageUserAccountCollection', key: 'TSAccountManager_RegistrationDateKey', value: 1793703360.93293 },
    ];
    const s = A.signalIos(rows, [{ deviceId: 1, createdAt: 1793703337.99, lastSeenAt: 1794355200, name: null }, { deviceId: 2, createdAt: 1793703673.047, lastSeenAt: 1794268800, name: 'macOS' }], KC.bplist.parse);
    const r = rowsOf(s);
    assert.strictEqual(r['Registrerad'].ms, 1793703360933);
    assert.strictEqual(r['Läskvitton'].value, 'På');
    assert.strictEqual(r['Kan hittas med numret'].value, 'På');
    assert.strictEqual(r['Vem ser mitt nummer'].value, 'Ingen');
    assert.strictEqual(r['Länkade enheter'].value, '1');
    assert.strictEqual(r['Länkade enheter'].checked, true);
    assert.strictEqual(r['macOS'].ms, 1793703673047);
    assert.strictEqual(r['macOS'].suffix, ' · senast sedd 2026-11-10');
    assert.deepStrictEqual(s.devices.map((d) => [d.id, d.linked, d.name]), [[1, false, 'Den här telefonen'], [2, true, 'macOS']]);
    // Ett krypterat namn visas inte som tecken.
    assert.strictEqual(A.signalIos([], [{ deviceId: 3, createdAt: 1, name: '\u0001\u0002binärt' }]).devices[0].name, 'krypterat namn');
});

test('Snapchat: Spara till är kontrollerad i labb på båda plattformarna, och användar-id och installationen', () => {
    const save = { value: 'MEMORIES_AND_CAMERA_ROLL', label: 'Memories och kamerarullen', copies: true, version: 8, changed: true, updatedMs: 1793399506269 };
    const r = rowsOf(A.snapchat('Android', save, { key_user_id: 'u-1' }));
    assert.strictEqual(r['Spara till'].value, 'Memories och kamerarullen');
    assert.strictEqual(r['Spara till'].checked, true);
    assert.match(r['Spara till'].note, /kopia av varje sparad snap/);
    assert.match(r['Spara till'].note, /row_version 8/);
    assert.strictEqual(r['Spara till senast skriven'].ms, 1793399506269);
    assert.strictEqual(r['Användar-id'].checked, false);
    const ios = rowsOf(A.snapchat('iOS', { value: 'MEMORIES', label: 'bara Memories', copies: false }, null, { first_install_date: 1793399400 }));
    assert.strictEqual(ios['Spara till'].value, 'Bara Memories');
    assert.strictEqual(ios['Spara till'].source, 'primary.docobjects · userproperties itemId 24');
    assert.strictEqual(ios['Installerad första gången'].ms, 1793399400000);
});

test('tiden i ord för försvinnande meddelanden', () => {
    assert.deepStrictEqual([0, 30, 300, 3600 * 8, 86400, 604800, 7776000].map(A.secondsText), ['Av', '30 sekunder', '5 minuter', '8 timmar', '24 timmar', '7 dagar', '90 dagar']);
});
