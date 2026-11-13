// Samsungs loggar: raderna är påhittade i samma form som på en labbtelefon (SM-A336B). Nät, appar och enhetens byggnummer är påhittade.

const test = require('node:test');
const assert = require('node:assert');
const logs = require('./samsung-logs');

const L = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);
const lcd = (t, onOff, extra) => t + ' [SET] [ND0XOXOMXXXXXXWXX / Wifi:"Testnät",5180MHz] [LCD] ' + onOff + (extra || '');
const rtc = (localText, utcText) => localText + ' [RTC] 148911.38 37981.19    ' + utcText + ' ' + Date.parse(utcText.replace(' ', 'T') + 'Z') / 1000;

const SSRM_A = [
    rtc('2026-05-22 10:00:00', '2026-05-22 08:00:00'),
    '2026-05-22 11:47:57 [VER] A000XXU1 START',
    '2026-05-22 11:47:58 [SET] [] [LCD] ON  [sleep_count = 1314, sleep_time_sec = 89793]',
    '2026-05-22 11:48:06 [PKG] org.example.chat',
    '2026-05-22 11:48:22 [PKG] android',
    '2026-05-22 11:48:23 [PKG] org.example.chat',
    lcd('2026-05-22 11:49:37', 'OFF', ' 582'),
    '2026-05-22 12:18:40 [COM] [(-3->-3)(24,25) LIGHT ScreenOff',
    lcd('2026-05-22 12:18:41', 'ON', ' 579  [sleep_count = 107, sleep_time_sec = 1500]'),
    '2026-05-22 12:24:54 [PKG] com.example.other',
    '2026-05-22 12:24:57 [SET] [ND0XOXOMOXXXXXWXX / Wifi:"Testnät",5180MHz] camera running :: true  client : org.example.chat',
    '2026-05-22 12:25:00 [SET] [ND0XOXOMXXXXXXWXX / Wifi:"Testnät",5180MHz] camera running :: false  client : org.example.chat',
    '2026-05-22 12:25:30 [SET] [ND0XOXOMOXXXXXWXX / Wifi:"Testnät",5180MHz] camera running :: true  client : com.example.other',
    '2026-05-22 12:26:00 [VER] A000XXU1 SHUTDOWN',
    '',
    '===== ABOVE LOGS ARE FROM LAST BOOTING =====',
    '',
].join('\n');
const SSRM_B = [
    '2026-05-23 08:00:00 [VER] A000XXU1 START',
    lcd('2026-05-23 08:00:01', 'ON'),
    '2026-05-23 08:00:05 [PKG] com.example.first',
    '2026-05-23 08:00:10 [TOP] [system_server=0.18%]',
    '2026-05-23 11:00:00 [TOP] [system_server=0.18%]',
    rtc('2026-05-23 11:00:01', '2026-05-23 09:00:02'),
].join('\n');

test('sökvägarna och urvalet av filer', () => {
    assert.ok(logs.isSsrmPath('/data/data/com.sec.android.sdhms/ssrm_heating_3.log'));
    assert.ok(logs.isSsrmPath('filesystem1/data/user/0/com.sec.android.sdhms/ssrm_heating_19.log'));
    assert.ok(!logs.isSsrmPath('/data/data/com.sec.android.sdhms/databases/thermal_log'));
    assert.ok(logs.isBatteryPath('/data/log/batterystats/newbatterystats260317080553'));
    assert.ok(!logs.isBatteryPath('/data/system/batterystats-daily.xml'));
    assert.strictEqual(logs.batteryNameMs('x/batterystats/newbatterystats260317080553'), L(2026, 3, 17, 8, 5, 53));
    const keep = logs.keeper();
    assert.ok(keep('data/log/batterystats/newbatterystats260317080553'));
    assert.ok(!keep('data/media/0/DCIM/Camera/x.jpg'));
    const sorted = logs.sortEntries([
        { name: 'data/log/batterystats/newbatterystats260804081912' }, { name: 'data/log/batterystats/newbatterystats260317080553' },
        { name: 'data/data/com.sec.android.sdhms/ssrm_heating_0.log' }, { name: 'data/user/0/com.sec.android.sdhms/ssrm_heating_0.log' },
    ]);
    assert.deepStrictEqual(sorted.battery.map((e) => e.name.slice(-12)), ['260317080553', '260804081912']);
    assert.strictEqual(sorted.ssrm.length, 1, 'samma fil under data/user/0 räknas en gång');
});

test('SSRM: app, skärm och kamera som intervall, filerna i skrivordning', () => {
    const p = logs.parseSsrm([{ name: 'ssrm_heating_0.log', text: SSRM_B }, { name: 'ssrm_heating_5.log', text: SSRM_A }]);
    assert.deepStrictEqual(p.apps.filter((a) => a.startLocal < L(2026, 5, 23)).map((a) => [a.app, a.startLocal, a.endLocal]), [
        ['org.example.chat', L(2026, 5, 22, 11, 48, 6), L(2026, 5, 22, 11, 48, 22)],
        ['android', L(2026, 5, 22, 11, 48, 22), L(2026, 5, 22, 11, 48, 23)],
        // Skärmen släcks: appen slutar där, och nästa app kommer inte förrän [PKG] säger det.
        ['org.example.chat', L(2026, 5, 22, 11, 48, 23), L(2026, 5, 22, 11, 49, 37)],
        ['com.example.other', L(2026, 5, 22, 12, 24, 54), L(2026, 5, 22, 12, 26, 0)],
    ]);
    assert.deepStrictEqual(p.screen.filter((a) => a.startLocal < L(2026, 5, 23)).map((a) => [a.on, a.startLocal, a.endLocal, !!a.openEnded]), [
        [true, L(2026, 5, 22, 11, 47, 58), L(2026, 5, 22, 11, 49, 37), false],
        [false, L(2026, 5, 22, 11, 49, 37), L(2026, 5, 22, 12, 18, 41), false],
        [true, L(2026, 5, 22, 12, 18, 41), L(2026, 5, 22, 12, 26, 0), false],
    ]);
    assert.deepStrictEqual(p.camera.map((c) => [c.app, c.startLocal, c.endLocal]), [
        ['org.example.chat', L(2026, 5, 22, 12, 24, 57), L(2026, 5, 22, 12, 25, 0)],
        // Ingen slutrad före avstängningen: slutet är okänt, inte tiden för sista raden.
        ['com.example.other', L(2026, 5, 22, 12, 25, 30), null],
    ]);
    assert.strictEqual(p.camera[0].from.file, 'ssrm_heating_5.log');
    assert.strictEqual(p.camera[0].from.line, 11);
    assert.ok(p.camera[0].from.raw.includes('camera running :: true'));
});

test('SSRM: ett uppehåll i loggen eller en omstart avslutar det som pågår', () => {
    const p = logs.parseSsrm([{ name: 'a.log', text: SSRM_B }]);
    assert.deepStrictEqual(p.apps.map((a) => [a.app, a.endLocal, !!a.openEnded]), [['com.example.first', L(2026, 5, 23, 8, 0, 10), true]], 'tre timmar utan rader är ett hål, inte samma app');
    assert.deepStrictEqual(p.spans.map((s) => [s.startLocal, s.endLocal]), [[L(2026, 5, 23, 8, 0, 0), L(2026, 5, 23, 8, 0, 10)], [L(2026, 5, 23, 11, 0, 0), L(2026, 5, 23, 11, 0, 1)]]);
    const both = logs.parseSsrm([{ name: 'a.log', text: SSRM_A }, { name: 'b.log', text: SSRM_B }]);
    assert.deepStrictEqual(both.spans.map((s) => s.startLocal), [L(2026, 5, 22, 10, 0, 0), L(2026, 5, 22, 11, 47, 57), L(2026, 5, 23, 8, 0, 0), L(2026, 5, 23, 11, 0, 0)], 'omstarten delar loggen');
    assert.ok(both.screen.every((s) => s.endLocal <= L(2026, 5, 22, 12, 26, 0) || s.startLocal >= L(2026, 5, 23)), 'ingen skärm över omstarten');
});

test('SSRM: filerna skrivs i tur och ordning och börjar om från 0', () => {
    const p = logs.parseSsrm([
        { name: 'ssrm_heating_0.log', text: '2026-05-24 18:13:44 [PKG] com.example.b\n2026-05-24 18:14:00 [SET] [] [LCD] OFF' },
        { name: 'ssrm_heating_19.log', text: '2026-05-24 18:00:00 [SET] [] [LCD] ON\n2026-05-24 18:10:00 [PKG] com.example.a' },
    ]);
    assert.deepStrictEqual(p.apps.map((a) => [a.app, a.startLocal, a.endLocal]), [
        ['com.example.a', L(2026, 5, 24, 18, 10, 0), L(2026, 5, 24, 18, 13, 44)],
        ['com.example.b', L(2026, 5, 24, 18, 13, 44), L(2026, 5, 24, 18, 14, 0)],
    ]);
    assert.strictEqual(p.apps[0].to.file, 'ssrm_heating_0.log');
});

test('SSRM: en ny uppstart utan avstängning, och raden om förra uppstarten', () => {
    const crash = logs.parseSsrm([{ name: 'a.log', text: ['2026-05-24 18:00:00 [SET] [] [LCD] ON', '2026-05-24 18:00:05 [PKG] com.example.a', '2026-05-24 18:00:10 [TOP] [x=1%]', '2026-05-24 18:02:00 [VER] A000 START', '2026-05-24 18:02:05 [TOP] [x=1%]'].join('\n') }]);
    assert.deepStrictEqual(crash.apps.map((a) => [a.endLocal, !!a.openEnded]), [[L(2026, 5, 24, 18, 0, 10), true]], 'appen slutar vid sista raden före uppstarten');
    assert.deepStrictEqual(crash.spans.map((s) => s.startLocal), [L(2026, 5, 24, 18, 0, 0), L(2026, 5, 24, 18, 2, 0)]);
    const marked = logs.parseSsrm([{ name: 'a.log', text: ['2026-05-24 18:00:00 [SET] [] [LCD] ON', '2026-05-24 18:00:05 [TOP] [x=1%]', '===== ABOVE LOGS ARE FROM LAST BOOTING =====', '2026-05-24 18:02:00 [TOP] [x=1%]'].join('\n') }]);
    assert.deepStrictEqual(marked.screen.map((a) => [a.endLocal, !!a.openEnded]), [[L(2026, 5, 24, 18, 0, 5), true]]);
    assert.strictEqual(marked.spans.length, 2);
});

test('SSRM: zonen ur [RTC], också när raden skrivs över en sekundgräns', () => {
    const p = logs.parseSsrm([{ name: 'a.log', text: SSRM_B + '\n' + rtc('2026-05-23 11:30:00', '2026-05-23 10:30:00') }]);
    assert.deepStrictEqual(p.offsets.map((o) => o.offsetMinutes), [120, 120, 60], 'avsnittets start, sekunden före sin [RTC], räknas med');
    assert.deepStrictEqual(logs.zoneAt(p.offsets, L(2026, 5, 23, 11, 0, 1)), { offsetMinutes: 120, unsureMs: 0 });
    // Zonen bytte mellan raderna: vilken sida en tid hör till går inte att säga.
    assert.deepStrictEqual(logs.zoneAt(p.offsets, L(2026, 5, 23, 11, 20, 0)), { offsetMinutes: 60, unsureMs: 3600000 });
    assert.deepStrictEqual(logs.zoneAt(p.offsets, L(2026, 5, 23, 11, 5, 0)), { offsetMinutes: 120, unsureMs: 3600000 });
    assert.strictEqual(logs.zoneAt([], 0), null);
    // Långt från enda kända zonen kan sommartiden ha bytt.
    const one = [{ localMs: L(2026, 6, 1, 0, 0, 0), offsetMinutes: 120 }];
    assert.strictEqual(logs.zoneAt(one, L(2026, 5, 25, 0, 0, 0)).unsureMs, 0);
    assert.strictEqual(logs.zoneAt(one, L(2026, 4, 1, 0, 0, 0)).unsureMs, 3600000);
});

// Labbet: telefonen låg låst i 28 dagar över sommartidens slut, så SSRM hoppade från +2 till +1 utan rader emellan. Raderna
// efter starten kommer sekunden före [RTC], och skärmen tänds på just de raderna.
const SSRM_ZONE = [
    rtc('2026-10-09 08:22:00', '2026-10-09 06:22:00'),
    lcd('2026-10-09 08:22:21', 'OFF'),
    '2026-10-09 08:34:06 [VER] A000 SHUTDOWN',
    '',
    '===== ABOVE LOGS ARE FROM LAST BOOTING =====',
    '',
    '2026-11-06 14:56:51 [VER] A000 START',
    '2026-11-06 14:56:51 [SET] [] [LCD] ON  [sleep_count = 6, sleep_time_sec = 39]',
    rtc('2026-11-06 14:56:52', '2026-11-06 13:56:56'),
    '2026-11-06 14:57:32 [PKG] org.example.chat',
    '2026-11-06 15:28:10 [VER] A000 SHUTDOWN',
].join('\n');

test('SSRM: raderna från starten till första [RTC] har den zonen, inte zonen före ett långt hål', () => {
    const p = logs.parseSsrm([{ name: 'a.log', text: SSRM_ZONE }]);
    assert.deepStrictEqual(logs.zoneAt(p.offsets, L(2026, 11, 6, 14, 56, 51)), { offsetMinutes: 60, unsureMs: 0 });
    const got = logs.collect({ windows: [{ startMs: L(2026, 11, 6, 13, 0, 0), endMs: L(2026, 11, 6, 15, 0, 0) }], ssrm: p });
    assert.deepStrictEqual(got.screen.map((x) => [x.on, x.startMs, x.endMs]), [[true, L(2026, 11, 6, 13, 56, 51), L(2026, 11, 6, 14, 28, 10)]]);
    assert.deepStrictEqual(got.unsure, []);
    // Före avstängningen går det inte att säga: zonen kan ha bytts när som helst efter den sista [RTC].
    assert.strictEqual(logs.zoneAt(p.offsets, L(2026, 10, 9, 8, 22, 21)).unsureMs, 3600000);
    // Långt från starten säger [RTC] inget om starten.
    const far = logs.parseSsrm([{ name: 'a.log', text: SSRM_ZONE.replace(rtc('2026-11-06 14:56:52', '2026-11-06 13:56:56'), rtc('2026-11-06 14:57:52', '2026-11-06 13:57:56')) }]);
    assert.strictEqual(logs.zoneAt(far.offsets, L(2026, 11, 6, 14, 56, 51)).unsureMs, 3600000);
    const near = logs.parseSsrm([{ name: 'a.log', text: SSRM_ZONE.replace(rtc('2026-11-06 14:56:52', '2026-11-06 13:56:56'), rtc('2026-11-06 14:57:51', '2026-11-06 13:57:55')) }]);
    assert.strictEqual(logs.zoneAt(near.offsets, L(2026, 11, 6, 14, 56, 51)).unsureMs, 0, 'exakt en minut räknas');
});

// Den nyare formen: datum utan år och en hexkolumn.
const BATTERY_DATE = [
    '  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000',
    '  05-22 10:00:00.000 078 c4900011 status=discharging health=good plug=none temp=243 volt=4105 current=0 -wifi_ap -otg -sub_screen -sub_screen_doze',
    '                 Stats: duration=605 bluetooth=rx: 0 tx: 0 idle: 605 scan: 1323',
    '  05-22 10:00:00.000 078 c4900011 top=u0a128:"com.example.launcher"',
    '  05-22 10:01:00.100 078 c4900011 -top=u0a128:"com.example.launcher"',
    '  05-22 10:01:00.104 078 c4900011 +top=u0a333:"org.example.chat"',
    '  05-22 10:01:30.500 078 c4900011 +camera pkgactive=u0a96:"com.example.notthis"',
    '  05-22 10:01:33.500 078 c4900011 -camera',
    '  05-22 10:02:00.000 078 84000011 -wake_lock=-1:"screen" -screen',
    '  05-22 10:10:00.000 078 c0900010 +wake_lock=-1:"screen" +screen brightness=dark',
    // Samma app ligger kvar, men ingen rad säger att den visas igen: kanske är det låsskärmen.
    '  05-22 10:10:05.000 078 84000011 -wake_lock=-1:"namn +screen fake" -screen',
    '  05-22 10:15:00.000 078 c4900011 -top=u0a333:"org.example.chat"',
    '  05-22 10:15:00.000 078 c4900011 +top=u0a77:"com.example.dark"',
    '  05-22 10:20:00.000 078 c0900010 +screen',
    '  05-22 10:20:01.000 078 c4900011 -top=u0a77:"com.example.dark"',
    '  05-22 10:20:01.000 078 c4900011 +top=u0a96:"com.example.camera"',
    '  05-22 10:20:30.000 078 c4900011 -top=u0a96:"com.example.camera"',
    '',
    'Per process state tracking available: true',
    '  05-22 23:00:00.000 078 c4900011 +camera',
].join('\n');

test('batterihistoriken, nyare formen: appen slutar när skärmen släcks och kommer inte tillbaka av sig själv', () => {
    const p = logs.parseBattery(BATTERY_DATE, 'newbatterystats260522120000');
    assert.strictEqual(p.format, 'date');
    assert.deepStrictEqual(p.apps.map((a) => [a.app, a.startLocal, a.endLocal, !!a.openEnded]), [
        ['com.example.launcher', L(2026, 5, 22, 10, 0, 0), L(2026, 5, 22, 10, 1, 0, 100), false],
        ['org.example.chat', L(2026, 5, 22, 10, 1, 0, 104), L(2026, 5, 22, 10, 2, 0), false],
        ['com.example.camera', L(2026, 5, 22, 10, 20, 1), L(2026, 5, 22, 10, 20, 30), false],
    ], 'en app som kommer i förgrunden medan skärmen är släckt visas inte');
    assert.deepStrictEqual(p.screen.map((s) => [s.on, s.startLocal, s.endLocal]), [
        [true, L(2026, 5, 22, 10, 0, 0), L(2026, 5, 22, 10, 2, 0)],
        [false, L(2026, 5, 22, 10, 2, 0), L(2026, 5, 22, 10, 10, 0)],
        [true, L(2026, 5, 22, 10, 10, 0), L(2026, 5, 22, 10, 10, 5)],
        [false, L(2026, 5, 22, 10, 10, 5), L(2026, 5, 22, 10, 20, 0)],
        [true, L(2026, 5, 22, 10, 20, 0), L(2026, 5, 22, 10, 20, 30)],
    ], '-sub_screen, wake_lock="screen" och en +screen inom citattecken är inte skärmen');
    assert.deepStrictEqual(p.camera.map((c) => [c.app, c.startLocal, c.endLocal, c.from.line]), [['org.example.chat', L(2026, 5, 22, 10, 1, 30, 500), L(2026, 5, 22, 10, 1, 33, 500), 7]],
        'kamerans app är den i förgrunden, inte pkgactive, och raderna efter historiken läses inte');
    assert.ok(p.camera[0].from.raw.startsWith('05-22 10:01:30.500 078 c4900011 +camera'));
});

test('batterihistoriken: +state säger vem som använder kameran, också när en annan app ligger överst', () => {
    const p = logs.parseBattery([
        '  11-06 15:06:00.000 RESET:TIME: 2026-11-06-15-06-00-000',
        '  11-06 15:06:01.000 097 c4110019 +screen',
        '  11-06 15:06:10.000 097 c4110019 +top=u0a50:"com.example.dialog"',
        // Paketet står först längre ner i filen.
        '  11-06 15:06:14.942 097 c4110019 +camera +state=10330:"camera"',
        '  11-06 15:06:19.554 097 c4110019 -camera -state=10330:"camera"',
        '  11-06 15:06:20.000 097 c4110019 -top=u0a50:"com.example.dialog"',
        '  11-06 15:06:20.100 097 c4110019 +top=u0a330:"org.example.snap"',
        // En uid som inte står någonstans: appen är okänd, inte den som råkar ligga överst.
        '  11-06 15:06:30.000 097 c4110019 +camera +state=10999:"camera" procstate: u0a46: cached',
        '  11-06 15:06:31.000 097 c4110019 -camera -state=10999:"camera"',
        // Uid 1000 delas av flera systemappar.
        '  11-06 15:06:40.000 097 c4110019 -top=u0a330:"org.example.snap"',
        '  11-06 15:06:40.100 097 c4110019 +top=1000:"com.example.settings"',
        '  11-06 15:06:41.000 097 c4110019 -top=1000:"com.example.settings"',
        '  11-06 15:06:41.100 097 c4110019 +top=1000:"com.example.setup"',
        '  11-06 15:06:42.000 097 c4110019 +camera +state=1000:"camera"',
        '  11-06 15:06:43.000 097 c4110019 -camera -state=1000:"camera"',
        // Utan +state: den i förgrunden, som förut.
        '  11-06 15:06:50.000 097 c4110019 +camera',
        '  11-06 15:06:51.000 097 c4110019 -camera',
        // En annan state på samma rad säger inget om kameran.
        '  11-06 15:06:52.000 097 c4110019 +camera +state=10330:"audio"',
        '  11-06 15:06:53.000 097 c4110019 -camera -state=10330:"audio"',
    ].join('\n'), 'newbatterystats261106152106');
    assert.deepStrictEqual(p.camera.map((c) => [c.app, !!c.byUid]), [['org.example.snap', true], [null, false], [null, false], ['com.example.setup', false], ['com.example.setup', false]]);
    const got = logs.collect({ windows: [{ startMs: L(2026, 11, 6, 13, 0, 0), endMs: L(2026, 11, 6, 15, 0, 0) }], battery: [p], zones: { newbatterystats261106152106: { offsetMinutes: 60, unsureMs: 0, oldest: false, nameMs: L(2026, 11, 6, 15, 21, 6) } } });
    assert.deepStrictEqual(got.camera.map((c) => [c.app, !!c.byUid]).slice(0, 2), [['org.example.snap', true], [null, false]]);
    // En ny fil börjar mitt i en användning: uid:n står på slutraden.
    const cut = logs.parseBattery(['  11-06 15:06:00.000 RESET:TIME: 2026-11-06-15-06-00-000', '  11-06 15:06:01.000 097 c4110019 +top=u0a330:"org.example.snap"', '  11-06 15:06:02.000 097 c4110019 -camera -state=u0a330:"camera"'].join('\n'), 'newbatterystats261106152106');
    assert.deepStrictEqual(cut.camera.map((c) => [c.app, c.byUid]), [['org.example.snap', true]]);
});

// Den äldre formen: tiden sedan historikens början, och ett ankare med hela tiden.
const BATTERY_REL = [
    'Battery History (86% used, 3560KB used of 4096KB, 2669 strings using 209KB):',
    '                    0 (18) START',
    '                    0 (20) TIME: 2026-03-12-11-53-20-151',
    '            +11s437ms (8) 090 status=discharging health=good plug=none temp=294 volt=4190 current=0 -wifi_ap -otg',
    '            +38s215ms (2) 090 +screen',
    '            +44s939ms (2) 090 +top=1000:"com.example.setup"',
    '            +54s636ms (20) TIME: 2026-03-12-11-54-15-304',
    '          +1m04s876ms (2) 090 -top=1000:"com.example.setup"',
    '          +1m04s943ms (2) 090 +top=u0a96:"com.example.camera"',
    '          +1m05s000ms (1) 090 +camera',
    '          +1m10s000ms (2) 090 -camera -top=u0a96:"com.example.camera"',
    '       +1h42m07s705ms (67) TIME: 2026-03-12-13-35-28-382',
    '       +1h42m08s000ms (2) 081 -screen',
    '    +3d03h25m09s733ms (18) SHUTDOWN',
    '    +3d03h25m09s734ms (18) START',
    '    +3d03h25m09s800ms (20) TIME: 2026-03-16-09-00-07-449',
    '    +3d03h26m00s000ms (2) 070 +screen',
    '    +3d03h26m10s000ms (2) 070 -screen',
].join('\n');

test('batterihistoriken, äldre formen: tiden räknas från senaste ankaret, och en omstart börjar om', () => {
    const p = logs.parseBattery(BATTERY_REL, 'newbatterystats260317080553');
    assert.strictEqual(p.format, 'offset');
    const anchor2 = L(2026, 3, 12, 11, 54, 15, 304);
    const offset = (ms) => anchor2 + ms - 54636;
    assert.deepStrictEqual(p.camera.map((c) => [c.startLocal, c.endLocal, c.app]), [[offset(65000), offset(70000), 'com.example.camera']]);
    // Första övergången är +screen: skärmen var släckt från ankaret dit.
    assert.deepStrictEqual(p.screen.map((s) => [s.on, s.startLocal]).slice(0, 2), [[false, L(2026, 3, 12, 11, 53, 20, 151)], [true, L(2026, 3, 12, 11, 53, 20, 151) + 38215]]);
    // Skärmen släcks vid avstängningen; efter omstarten vet ingen hur den var förrän första raden.
    const after = p.screen.filter((s) => s.startLocal >= L(2026, 3, 16));
    assert.deepStrictEqual(after.map((s) => [s.on, s.startLocal, s.endLocal]), [[false, L(2026, 3, 16, 9, 0, 7, 449), L(2026, 3, 16, 9, 0, 7, 449) + 50200], [true, L(2026, 3, 16, 9, 0, 7, 449) + 50200, L(2026, 3, 16, 9, 0, 7, 449) + 60200]]);
    assert.ok(p.screen.filter((s) => s.startLocal < L(2026, 3, 16)).every((s) => s.endLocal <= L(2026, 3, 16)), 'inget över avstängningen');
    assert.strictEqual(p.firstLocal, L(2026, 3, 12, 11, 53, 20, 151));
    // Tiden mellan avstängningen och starten är inget steg i klockan.
    const atRestart = p.segments.findIndex((s) => s.startLocal === L(2026, 3, 16, 9, 0, 7, 449));
    assert.strictEqual(p.segments[atRestart].startStep, null);
    assert.strictEqual(p.segments[atRestart - 1].endStep, null);
    assert.strictEqual(p.segments[atRestart].clockMs, 0);
});

test('batterihistoriken: en rad som spänner över flera avsnitt är inte säkrare än det sämsta av dem', () => {
    const p = logs.parseBattery([
        '  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000',
        '  05-22 10:00:01.000 078 c4900011 +screen',
        '  05-22 10:00:02.000 078 c4900011 +running',
        '  05-22 10:01:02.000 TIME: 2026-05-22-10-01-02-000',
        '  05-22 10:01:02.000 078 c4900011 -running',
        '  05-22 10:01:10.000 078 c4900011 -screen',
    ].join('\n'), 'newbatterystats260522100110');
    assert.deepStrictEqual(p.segments.map((s) => s.clockMs), [0, 60000]);
    assert.strictEqual(p.screen.find((s) => s.on).clockMs, 60000);
});

test('batterihistoriken: tillståndsraden efter RESET:TIME: säger läget, utan ett intervall utan längd', () => {
    const p = logs.parseBattery(['  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000', '  05-22 10:00:00.000 078 c4900011 status=full health=good plug=usb +screen +running', '  05-22 10:00:30.000 078 84000011 -screen'].join('\n'), 'newbatterystats260522100030');
    assert.deepStrictEqual(p.screen.map((s) => [s.on, s.startLocal, s.endLocal]), [[true, L(2026, 5, 22, 10, 0, 0), L(2026, 5, 22, 10, 0, 30)]]);
});

test('batterihistoriken: en app som öppnades innan skärmens läge var känt räknas bara om skärmen var tänd', () => {
    const on = logs.parseBattery(['  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000', '  05-22 10:00:00.000 078 c4900011 top=u0a128:"com.example.a"', '  05-22 10:00:30.000 078 84000011 -screen'].join('\n'), 'newbatterystats260522100030');
    assert.deepStrictEqual(on.apps.map((a) => a.app), ['com.example.a']);
    const off = logs.parseBattery(['  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000', '  05-22 10:00:00.000 078 c4900011 top=u0a128:"com.example.a"', '  05-22 10:00:30.000 078 84000011 +screen'].join('\n'), 'newbatterystats260522100030');
    assert.deepStrictEqual(off.apps, []);
});

test('batterihistoriken: datum utan år över ett årsskifte', () => {
    const p = logs.parseBattery(['  12-31 23:59:00.000 RESET:TIME: 2025-12-31-23-59-00-000', '  12-31 23:59:10.000 090 c4900011 +screen', '  01-01 00:00:10.000 090 c4900011 -screen'].join('\n'), 'newbatterystats260101000020');
    assert.deepStrictEqual(p.screen.filter((s) => s.on).map((s) => [s.startLocal, s.endLocal]), [[L(2025, 12, 31, 23, 59, 10), L(2026, 1, 1, 0, 0, 10)]]);
});

test('batterihistoriken: kameran som redan var på när filen började, och kameran när filen slutar', () => {
    const p = logs.parseBattery(['  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000', '  05-22 10:00:02.000 078 c4900011 -camera', '  05-22 10:00:05.000 078 c4900011 +camera', '  05-22 10:00:06.000 078 c4900011 status=full'].join('\n'), 'newbatterystats260522100006');
    assert.deepStrictEqual(p.camera.map((c) => [c.startLocal, c.endLocal, !!c.openEnded]), [
        [L(2026, 5, 22, 10, 0, 0), L(2026, 5, 22, 10, 0, 2), false],
        [L(2026, 5, 22, 10, 0, 5), L(2026, 5, 22, 10, 0, 6), true],
    ]);
});

// Labbets förlopp: telefonen vaknar med +running, och ibland skrivs -running sent. Tiden i ankaret är då för sen, och
// raderna efter ligger för sent tills ett senare ankare stegar tillbaka.
const CLOCK = [
    '  09-30 08:19:21.342 RESET:TIME: 2026-09-30-08-19-21-342',
    '  09-30 08:19:21.342 061 84800018 +running wake_reason=0:"186 wlan_mbox_irq"',
    '  09-30 08:19:22.000 061 84800018 +screen',
    '  09-30 08:19:30.000 061 84800018 -screen',
    '  09-30 08:22:04.370 TIME: 2026-09-30-08-22-04-370',          // +154 s, följs av -running: sen skrivning
    '  09-30 08:22:04.370 061 04800018 -running',
    '  09-30 08:24:46.087 061 80800018 +screen',
    '  09-30 08:24:50.000 061 80800018 -screen',
    '  09-30 08:22:30.000 TIME: 2026-09-30-08-22-30-000',          // −140 s: tillbaka
    '  09-30 08:22:31.000 061 80800018 +screen',
    '  09-30 08:22:40.000 061 80800018 -screen',
    '  09-30 08:22:50.000 061 00000018 -running',
    '  09-30 08:23:09.300 TIME: 2026-09-30-08-23-09-300',          // +19 s, följs av +running: telefonen sov, inget fel i klockan
    '  09-30 08:23:09.300 061 80800018 +running wake_reason=0:"268 contexthub"',
    '  09-30 08:23:10.000 061 80800018 +screen',
    '  09-30 08:23:20.000 061 80800018 -screen',
].join('\n');

test('klockan: ett steg bakåt och en sen skrivning gör raderna osäkra, ett uppehåll i raderna gör det inte', () => {
    const p = logs.parseBattery(CLOCK, 'newbatterystats260930083000');
    assert.deepStrictEqual(p.segments.map((s) => [s.startStep, s.endStep, s.follow, s.clockMs]), [
        [null, 154370, 'wake', 0],
        [154370, -140000, 'late', 154370],
        [-140000, 19300, 'other', 0],
        [19300, null, 'wake', 0],
    ]);
    const rows = p.screen.filter((s) => s.on).map((s) => [s.startLocal, s.clockMs]);
    assert.strictEqual(rows.find((r) => r[0] === L(2026, 9, 30, 8, 19, 22))[1], 0, 'före den sena skrivningen');
    assert.strictEqual(rows.find((r) => r[0] === L(2026, 9, 30, 8, 24, 46, 87))[1], 154370, 'efter den sena skrivningen');
    assert.strictEqual(rows.find((r) => r[0] === L(2026, 9, 30, 8, 22, 31))[1], 0, 'klockan är tillbaka');
    assert.strictEqual(rows.find((r) => r[0] === L(2026, 9, 30, 8, 23, 10))[1], 0, 'telefonen sov, klockan har inte flyttats');
});

test('klockan: ett steg bakåt gör avsnittet före osäkert, också utan sen skrivning', () => {
    const gap = logs.parseBattery([
        '  09-30 08:00:00.000 RESET:TIME: 2026-09-30-08-00-00-000',
        '  09-30 08:00:01.000 061 80800018 +screen',
        '  09-30 08:00:05.000 061 80800018 -screen',
        '  09-30 08:00:30.000 TIME: 2026-09-30-08-00-30-000',
        '  09-30 08:00:31.000 061 80800018 +running wake_reason=0:"268 contexthub"',
        '  09-30 08:00:32.000 061 80800018 +screen',
        '  09-30 08:01:30.000 TIME: 2026-09-30-08-01-30-000',
        '  09-30 08:01:31.000 061 80800018 -screen',
    ].join('\n'), 'newbatterystats260930080131');
    assert.deepStrictEqual(gap.segments.map((s) => [s.follow, s.clockMs]), [['other', 0], ['wake', 0], ['other', 58000]],
        'telefonen vaknade: ett uppehåll. En annan rad efter ett steg framåt kan vara en sen skrivning');
    const back = logs.parseBattery([
        '  09-30 08:00:00.000 RESET:TIME: 2026-09-30-08-00-00-000',
        '  09-30 08:00:30.000 061 80800018 +screen',
        '  09-30 08:00:40.000 061 80800018 -screen',
        '  09-30 08:00:20.000 TIME: 2026-09-30-08-00-20-000',
        '  09-30 08:00:21.000 061 80800018 +screen',
        '  09-30 08:00:22.000 061 80800018 -screen',
    ].join('\n'), 'newbatterystats260930080022');
    assert.deepStrictEqual(back.segments.map((s) => s.clockMs), [20000, 0]);
    assert.strictEqual(back.screen.find((s) => s.on && s.startLocal === L(2026, 9, 30, 8, 0, 30)).clockMs, 20000);
    assert.strictEqual(back.screen.find((s) => s.on && s.startLocal === L(2026, 9, 30, 8, 0, 21)).clockMs, 0);
});

test('klockan: i den äldre formen är steget exakt och räknas åt båda håll, och klockan ställd med timmar är osäker', () => {
    const p = logs.parseBattery([
        '                    0 (20) TIME: 2026-03-12-11-00-00-000',
        '            +10s000ms (2) 090 +screen',
        '            +20s000ms (2) 090 -screen',
        '         +1h00m00s000ms (20) TIME: 2026-03-12-12-00-30-000',
        '         +1h00m05s000ms (2) 090 +screen',
        '         +1h00m06s000ms (2) 090 -screen',
        '         +2h00m00s000ms (20) TIME: 2026-03-12-13-00-30-000',
        '         +2h00m01s000ms (2) 090 +screen',
    ].join('\n'), 'newbatterystats260312130031');
    assert.deepStrictEqual(p.segments.map((s) => [s.startStep, s.endStep, s.clockMs]), [[null, 30000, 30000], [30000, 0, 30000], [0, null, 0]]);
    const date = logs.parseBattery([
        '  01-01 13:07:36.000 RESET:TIME: 2021-01-01-13-07-36-000',
        '  01-01 13:07:40.000 061 80800018 +screen',
        '  01-01 13:07:50.000 061 80800018 -screen',
        '  01-01 13:08:00.000 TIME: 2026-02-10-09-54-48-000',
        '  02-10 09:54:49.000 061 80800018 status=full',
    ].join('\n'), 'newbatterystats260210095449');
    assert.ok(date.segments[0].clockMs > 3600000, 'ställd klocka är inget uppehåll i raderna');
    assert.strictEqual(date.segments[1].clockMs, 0);
    assert.strictEqual(date.firstLocal, L(2026, 2, 10, 9, 54, 48), 'täckningen räknas inte från 2021');
});

test('filens zon: filnamnet mot ändringstiden, och en fil över ett zonbyte', () => {
    const e = (name, mtimeMs) => ({ name: 'data/log/batterystats/newbatterystats' + name, mtimeMs });
    assert.strictEqual(logs.fileOffset(e('260225100915', L(2026, 2, 25, 9, 9, 15))), 60);
    assert.strictEqual(logs.fileOffset(e('260226091639', L(2026, 2, 26, 8, 16, 40))), 60, 'en sekund från namnet');
    assert.strictEqual(logs.fileOffset(e('260225100915', L(2026, 2, 28, 0, 0, 0))), null, 'en kopia med en annan tid säger inget om zonen');
    assert.strictEqual(logs.fileOffset(e('260225100915', L(2026, 2, 25, 9, 3, 15))), null, 'inte på en kvart när');
    assert.strictEqual(logs.fileOffset(e('260225100915', null)), null);
    const zones = logs.batteryZones([e('260319133802', L(2026, 3, 19, 12, 38, 2)), e('260521101855', L(2026, 5, 21, 8, 18, 56)), e('260522121842', L(2026, 5, 22, 10, 18, 42))], []);
    assert.deepStrictEqual([zones.newbatterystats260319133802.offsetMinutes, zones.newbatterystats260319133802.unsureMs], [60, 0]);
    assert.deepStrictEqual([zones.newbatterystats260521101855.offsetMinutes, zones.newbatterystats260521101855.unsureMs], [120, 3600000], 'filen spänner över bytet till sommartid');
    assert.deepStrictEqual([zones.newbatterystats260522121842.offsetMinutes, zones.newbatterystats260522121842.unsureMs], [120, 0]);
    // Utan ändringstid: SSRM:s zon. Utan den heller: ingen zon.
    const viaSsrm = logs.batteryZones([e('260522121842', null)], [{ localMs: L(2026, 5, 22, 10, 0, 0), offsetMinutes: 120 }]);
    assert.strictEqual(viaSsrm.newbatterystats260522121842.offsetMinutes, 120);
    const none = logs.batteryZones([e('260522121842', null)], []);
    assert.strictEqual(none.newbatterystats260522121842.offsetMinutes, null);
    assert.strictEqual(logs.batteryZoneAt(none.newbatterystats260522121842, L(2026, 5, 22, 10, 0, 0)), null);
    // Den äldsta filen har inget att jämföra med.
    const oldest = zones.newbatterystats260319133802;
    assert.strictEqual(logs.batteryZoneAt(oldest, L(2026, 3, 19, 10, 0, 0)).unsureMs, 0);
    assert.strictEqual(logs.batteryZoneAt(oldest, L(2026, 2, 1, 10, 0, 0)).unsureMs, 3600000);
});

test('urvalet: filen täcker tiden från förra filens namn till sitt eget', () => {
    const list = ['260225100915', '260317080553', '260521101855'].map((n) => ({ name: 'x/batterystats/newbatterystats' + n }));
    const names = (...windows) => logs.pickBattery(list, windows).map((e) => e.name.slice(-12));
    const at = (ms) => ({ startMs: ms - 900000, endMs: ms + 900000 });
    assert.deepStrictEqual(names(at(L(2026, 3, 12, 12, 31, 11))), ['260317080553']);
    assert.deepStrictEqual(names(at(L(2026, 1, 1, 0, 0, 0))), ['260225100915'], 'före den äldsta filen');
    assert.deepStrictEqual(names(at(L(2026, 8, 1, 0, 0, 0))), [], 'efter den sista');
    assert.deepStrictEqual(names(at(L(2026, 3, 17, 7, 0, 0))), ['260317080553', '260521101855'], 'ett dygns marginal för zonen');
    assert.deepStrictEqual(names(at(L(2026, 1, 1, 0, 0, 0)), at(L(2026, 5, 1, 0, 0, 0))), ['260225100915', '260521101855'], 'två tidpunkter långt isär: inget läses mellan dem');
    assert.deepStrictEqual(names(at(L(2026, 2, 25, 23, 0, 0)), at(L(2026, 5, 21, 8, 30, 0))), ['260225100915', '260317080553', '260521101855'], 'filen efter tiden hör till');
});

function sample() {
    const ssrm = logs.parseSsrm([{ name: 'ssrm_heating_5.log', text: SSRM_A }]);
    const date = logs.parseBattery(BATTERY_DATE, 'newbatterystats260522120000');
    return { ssrm, date, zones: { newbatterystats260522120000: { offsetMinutes: 120, unsureMs: 0, oldest: false, nameMs: L(2026, 5, 22, 12, 0, 0) } } };
}

test('raderna i fönstret: UTC, källan med råraderna, och starkaste källan för app och skärm', () => {
    const { ssrm, date, zones } = sample();
    const range = { startMs: L(2026, 5, 22, 8, 0, 0), endMs: L(2026, 5, 22, 10, 30, 0) };
    const got = logs.collect({ windows: [range], ssrm, battery: [date], zones, primary: [] });
    const chat = got.camera.filter((c) => c.stream === 'SSRM')[0];
    assert.deepStrictEqual([chat.app, chat.startMs, chat.endMs], ['org.example.chat', L(2026, 5, 22, 10, 24, 57), L(2026, 5, 22, 10, 25, 0)]);
    assert.strictEqual(chat.source.db, 'SSRM');
    assert.strictEqual(chat.source.table, 'ssrm_heating_5.log rad 11–12');
    assert.ok(chat.source.column.includes('camera running :: true') && chat.source.column.includes('camera running :: false'));
    assert.strictEqual(chat.source.queryId, 'ssrm-heating');
    assert.strictEqual(got.usedSsrm['ssrm_heating_5.log'], true);
    // Kameran ur batterihistoriken står kvar bredvid SSRM:s.
    const battCam = got.camera.filter((c) => c.stream === 'batterihistoriken');
    assert.deepStrictEqual(battCam.map((c) => [c.app, c.startMs]), [['org.example.chat', L(2026, 5, 22, 8, 1, 30, 500)]]);
    assert.strictEqual(battCam[0].source.db, 'batterihistoriken');
    assert.strictEqual(battCam[0].source.queryId, 'batterystats-history');
    // Batterihistoriken täcker tiden före SSRM:s start, och där gäller den.
    assert.ok(got.apps.some((a) => a.stream === 'batterihistoriken' && a.app === 'org.example.chat' && a.startMs === L(2026, 5, 22, 8, 1, 0, 104)));
    // Telefonens egen logg går före båda.
    const withPrimary = logs.collect({ windows: [range], ssrm, battery: [date], zones, primary: [{ startMs: L(2026, 5, 22, 7, 0, 0), endMs: L(2026, 5, 22, 11, 0, 0) }] });
    assert.deepStrictEqual(withPrimary.apps, []);
    assert.deepStrictEqual(withPrimary.screen, []);
    assert.strictEqual(withPrimary.camera.length, 3, 'kameran har ingen sådan ordning');
    // SSRM går före batterihistoriken där SSRM täcker tiden.
    const inside = logs.collect({ windows: [{ startMs: L(2026, 5, 22, 9, 47, 0), endMs: L(2026, 5, 22, 10, 30, 0) }], ssrm, battery: [logs.parseBattery(BATTERY_DATE.split('05-22 10:').join('05-22 12:').split('2026-05-22-10-').join('2026-05-22-12-'), 'newbatterystats260522120000')], zones, primary: [] });
    assert.ok(inside.apps.every((a) => a.stream === 'SSRM'));
    assert.ok(inside.camera.some((c) => c.stream === 'batterihistoriken'));
    // Två tidpunkter långt isär: raderna mellan dem hör inte till någon av dem.
    const two = logs.collect({ windows: [{ startMs: L(2026, 5, 22, 8, 1, 0), endMs: L(2026, 5, 22, 8, 2, 0) }, { startMs: L(2026, 5, 22, 10, 25, 0), endMs: L(2026, 5, 22, 10, 25, 10) }], ssrm, battery: [date], zones, primary: [] });
    assert.deepStrictEqual(two.camera.map((c) => c.stream + ' ' + c.app).sort(), ['SSRM org.example.chat', 'batterihistoriken org.example.chat']);
    assert.ok(!two.apps.some((a) => a.app === 'com.example.camera'), 'raden mellan fönstren är borta');
});

test('raderna i fönstret: en osäker klocka eller zon räknas inte, och rader utan zon nämns', () => {
    const p = logs.parseBattery(CLOCK, 'newbatterystats260930083000');
    const zones = { newbatterystats260930083000: { offsetMinutes: 120, unsureMs: 0, oldest: false, nameMs: L(2026, 9, 30, 8, 30, 0) } };
    const range = { startMs: L(2026, 9, 30, 6, 0, 0), endMs: L(2026, 9, 30, 7, 0, 0) };
    const got = logs.collect({ windows: [range], battery: [p], zones, primary: [] });
    const u = got.unsure.filter((x) => x.what === 'screen' && x.on);
    assert.deepStrictEqual(u.map((x) => [x.startMs, x.clockMs]), [[L(2026, 9, 30, 6, 24, 46, 87), 154370]]);
    assert.ok(got.screen.some((s) => s.on && s.startMs === L(2026, 9, 30, 6, 22, 31)), 'avsnittet efter att klockan är tillbaka räknas');
    assert.ok(!got.screen.some((s) => s.on && s.startMs === L(2026, 9, 30, 6, 24, 46, 87)));
    const zoneOff = logs.collect({ windows: [range], battery: [p], zones: { newbatterystats260930083000: Object.assign({}, zones.newbatterystats260930083000, { unsureMs: 3600000 }) }, primary: [] });
    assert.deepStrictEqual([zoneOff.screen.length, zoneOff.unsure.every((x) => x.zoneMs === 3600000)], [0, true]);
    const noZone = logs.collect({ windows: [range], battery: [p], zones: { newbatterystats260930083000: { offsetMinutes: null, unsureMs: 0 } }, primary: [] });
    assert.ok(noZone.noZone > 0);
    assert.deepStrictEqual(noZone.screen, []);
});

test('raderna i fönstret: täta rader slås ihop över filer, med källans första och sista rad', () => {
    const a = logs.parseBattery(['  05-22 10:00:00.000 RESET:TIME: 2026-05-22-10-00-00-000', '  05-22 10:00:01.000 078 c4900011 +screen', '  05-22 10:00:02.000 078 c4900011 +top=u0a96:"com.example.camera"', '  05-22 10:00:03.000 078 c4900011 +camera', '  05-22 10:00:04.000 078 c4900011 -top=u0a96:"com.example.camera"', '  05-22 10:00:04.100 078 c4900011 +top=u0a96:"com.example.camera"', '  05-22 10:00:05.000 078 c4900011 status=full'].join('\n'), 'newbatterystats260522100005');
    const b = logs.parseBattery(['  05-22 10:00:05.500 RESET:TIME: 2026-05-22-10-00-05-500', '  05-22 10:00:05.500 078 c4900011 top=u0a96:"com.example.camera"', '  05-22 10:00:07.000 078 c4900011 -camera', '  05-22 10:00:08.000 078 c4900011 -screen'].join('\n'), 'newbatterystats260522100008');
    const z = { offsetMinutes: 0, unsureMs: 0, oldest: false, nameMs: 0 };
    const got = logs.collect({ windows: [{ startMs: L(2026, 5, 22, 9, 0, 0), endMs: L(2026, 5, 22, 11, 0, 0) }], battery: [a, b], zones: { newbatterystats260522100005: z, newbatterystats260522100008: z }, primary: [] });
    assert.deepStrictEqual(got.apps.map((x) => [x.app, x.startMs, x.endMs]), [['com.example.camera', L(2026, 5, 22, 10, 0, 2), L(2026, 5, 22, 10, 0, 8)]]);
    assert.strictEqual(got.apps[0].source.table, 'newbatterystats260522100005 rad 3, newbatterystats260522100008 rad 4');
    assert.deepStrictEqual(got.camera.map((x) => [x.startMs, x.endMs, x.openEnded]), [[L(2026, 5, 22, 10, 0, 3), L(2026, 5, 22, 10, 0, 7), false]], 'kameran över filgränsen');
    assert.deepStrictEqual(got.screen.filter((s) => s.on).map((x) => [x.startMs, x.endMs]), [[L(2026, 5, 22, 10, 0, 1), L(2026, 5, 22, 10, 0, 8)]]);
});

test('täckningen: delarna av SSRM-loggen och hålen i batterihistoriken', () => {
    const p = logs.parseSsrm([{ name: 'a.log', text: SSRM_A }, { name: 'b.log', text: SSRM_B }]);
    const c = logs.ssrmCoverage(p);
    assert.strictEqual(c.firstMs, L(2026, 5, 22, 8, 0, 0));
    assert.strictEqual(c.lastMs, L(2026, 5, 23, 9, 0, 1));
    assert.strictEqual(c.rows, p.rows);
    assert.deepStrictEqual(c.gaps.map((g) => g.startMs), [L(2026, 5, 22, 8, 0, 0), L(2026, 5, 22, 10, 26, 0), L(2026, 5, 23, 6, 0, 10)]);
    const e = (name) => ({ name: 'x/batterystats/newbatterystats' + name });
    const list = [e('251202164513'), e('260112084713')];
    const zones = { newbatterystats251202164513: { offsetMinutes: 60 }, newbatterystats260112084713: { offsetMinutes: 60 } };
    const parsed = { newbatterystats251202164513: { firstLocal: L(2025, 12, 2, 14, 58, 3) }, newbatterystats260112084713: { firstLocal: L(2025, 12, 12, 13, 7, 44) } };
    const b = logs.batteryCoverage(list, zones, parsed);
    assert.strictEqual(b.firstMs, L(2025, 12, 2, 13, 58, 3));
    assert.strictEqual(b.lastMs, L(2026, 1, 12, 7, 47, 13));
    assert.deepStrictEqual(b.gaps, [{ startMs: L(2025, 12, 2, 15, 45, 13), endMs: L(2025, 12, 12, 12, 7, 44) }]);
    assert.deepStrictEqual(logs.batteryCoverage(list, zones, { newbatterystats251202164513: parsed.newbatterystats251202164513 }).gaps, [], 'en fil som inte är läst har inget känt hål');
});

// ---------- eRR.p ----------

const errHead = (n) => 'LOGM' + String.fromCharCode(n, 0, 0, 0, n - 1, 0, 0, 0) + '\n\n\n\n';
const err = (lines) => logs.parseErr(errHead(lines.length) + lines.join('\n') + '\n', 'eRR.p');
const spanKinds = (list) => list.map((s) => s.kind + (s.why ? '/' + s.why : ''));
const spansOf = (e, over) => logs.powerSpans(Object.assign({ err: e, boots: [], unlocks: [], covered: () => true, ssrmSpans: [] }, over));
const REBOOT = (t, why) => t + '+0200 |  REBOOT  |       | REASON: ' + why + ' [28]';
const OFF = (t, why) => t + '+0200 | SHUTDOWN |       | REASON: ' + why;
const ON = (t, code) => t + '+0200 |    ON    | ' + (code || 'RP') + '    | A000XXU1 [29]';

test('eRR.p: raderna i alla former, med egen zon, orsak och krasch', () => {
    const e = logs.parseErr(errHead(9) + [
        '2025-11-13 09:49:17+0100 |    ON    | KP    | A000XXU1 / OFFSRC: - / ONSRC: ACOKB / RSTSTAT: SWRESET / RCNT: 1 / PC: f+0x1/0x4 LR: g+0x8/0x4 PANIC: Oops: Fatal exception [0]',
        '2025-11-13 10:29:37+0100 |  REBOOT  |       | REASON: shell [0]',
        '2025-12-12 00:40:21+0100 | SHUTDOWN |       | REASON: no power',
        '2025-12-12 11:28:40+0000 |          | NP    | OFFSRC: PWRHOLD / ONSRC: PWRONB / RSTSTAT: PINRESET RSVD31 / RCNT: 0 / PC: - LR: - / 3624000(1%) ',
        '2025-12-12 11:28:40+0000 |   LPM    |',
        '2026-03-16 08:05:56+0000 |   LPM    |       |',
        '2026-04-21 19:38:51+0200 |    ON    | NP    | A000XXU1 / OFFSRC: PWRHOLD / ONSRC: PWRONB / RSTSTAT: PINRESET PORESET [28]/ apex_updated ',
        '2026-04-22 09:00:00+0200 | PLATFORM | PF_NT | A000XXU1 / system_server [2]',
        '2026-04-24 19:46:27+0200 |  REBOOT  |       | REASON: device_locked_3days [28]',
    ].join('\n') + '\n', 'eRR.p');
    assert.strictEqual(e.headerRows, 9);
    assert.strictEqual(e.rows.length, 9);
    assert.deepStrictEqual(e.rows.map((r) => r.what), ['ON', 'REBOOT', 'SHUTDOWN', '', 'LPM', 'LPM', 'ON', 'PLATFORM', 'REBOOT']);
    assert.deepStrictEqual(e.rows.map((r) => r.kind), ['on', 'down', 'down', 'other', 'other', 'other', 'on', 'other', 'down']);
    assert.strictEqual(e.rows[0].ms, L(2025, 11, 13, 8, 49, 17), 'zonen i raden gäller');
    assert.strictEqual(e.rows[3].ms, L(2025, 12, 12, 11, 28, 40), '+0000 är UTC');
    assert.strictEqual(e.rows[8].ms, L(2026, 4, 24, 17, 46, 27));
    assert.strictEqual(logs.parseErr('2026-04-24 12:00:00-0530 |    ON    | RP    | A [1]', 'x').rows[0].ms, L(2026, 4, 24, 17, 30, 0), 'zon väster om UTC');
    assert.ok(e.rows[0].crash && !e.rows[6].crash);
    assert.strictEqual(e.rows[0].code, 'KP');
    assert.deepStrictEqual(e.rows.map((r) => r.reason), [null, 'shell', 'no power', null, null, null, null, null, 'device_locked_3days']);
    assert.strictEqual(e.rows[0].line, 5, 'radnumret är filens');
    assert.strictEqual(e.clockLost, 0);
});

test('eRR.p: en rad med en tid före raden innan har fel klocka, och huvudet säger hur många rader som ska finnas', () => {
    const e = logs.parseErr(errHead(4) + [
        OFF('2026-01-27 00:05:24', 'no power'),
        OFF('2023-10-12 16:49:57', 'no power'),
        '2023-10-17 03:26:59+0000 |   LPM    |',
        ON('2026-02-10 10:07:14'),
    ].join('\n'), 'eRR.p');
    assert.deepStrictEqual(e.rows.map((r) => !!r.clockLost), [false, true, true, false]);
    assert.strictEqual(e.clockLost, 2);
    assert.strictEqual(logs.parseErr('2026-01-27 00:05:24+0100 | SHUTDOWN |       | REASON: no power', 'x').headerRows, null, 'utan huvud');
    assert.strictEqual(logs.parseErr(new Uint8Array([76, 79, 71, 77, 200, 1, 0, 0]), 'x').headerRows, 456, 'fyra byte, minst värd först');
    assert.deepStrictEqual(logs.parseErr('skräp\n2026-01-27 | ON |\n', 'x').rows, []);
});

test('eRR.p: filen hittas på sin sökväg, och andra filer tas inte för den', () => {
    const keep = logs.keeper();
    ['data/system/users/service/data/eRR.p', 'Dump/data/system/users/service/data/eRR.p', '/data/system/users/service/data/eRR.p'].forEach((n) => assert.ok(keep(n) && logs.isErrPath(n), n));
    ['data/system/users/service/data/RC.p', 'data/system/users/service/data/xeRR.p', 'data/media/0/eRR.p'].forEach((n) => assert.ok(!logs.isErrPath(n), n));
    const got = logs.sortEntries([{ name: 'Dump/data/system/users/service/data/eRR.p' }, { name: 'data/log/batterystats/newbatterystats260312133200' }]);
    assert.strictEqual(got.err.name, 'Dump/data/system/users/service/data/eRR.p');
    assert.strictEqual(logs.sortEntries([]).err, null);
});

test('batterihistoriken: starterna och första appen efter dem, inte skärmen före upplåsningen', () => {
    const p = logs.parseBattery([
        '                    0 (17) START',
        '                    0 (19) TIME: 2026-05-25-12-50-29',
        '            +10s000ms (2) 100 +screen',
        '            +11s000ms (2) 100 +top=1000:"com.android.settings"',
        '            +40s000ms (2) 100 -top=1000:"com.android.settings"',
        '            +50s000ms (2) 100 +top=u0a96:"com.sec.android.app.launcher"',
        '          +1m00s000ms (2) 100 -top=u0a96:"com.sec.android.app.launcher"',
        '          +1m01s000ms (2) 100 +top=u0a98:"org.example.chat"',
        '          +2m00s000ms (17) SHUTDOWN',
        '          +2m00s001ms (17) START',
        '          +2m00s002ms (19) TIME: 2026-05-25-13-00-00',
        '          +2m10s000ms (2) 100 +top=1000:"com.android.settings"',
        '          +2m20s000ms (2) 100 +top=u0a98:"org.example.chat"',
        '          +2m30s000ms (19) TIME: 2026-05-25-13-00-28',
    ].join('\n'), 'newbatterystats260525130100');
    assert.deepStrictEqual(p.boots.map((b) => [b.localMs, b.line]), [[L(2026, 5, 25, 12, 50, 29), 2], [L(2026, 5, 25, 13, 0, 0), 11]]);
    assert.deepStrictEqual(p.unlocks.map((u) => [u.localMs, u.app, u.line]), [[L(2026, 5, 25, 12, 51, 19), 'com.sec.android.app.launcher', 6], [L(2026, 5, 25, 13, 0, 19, 998), 'org.example.chat', 13]]);
    assert.ok(p.boots[0].raw.includes('TIME: 2026-05-25-12-50-29'));
    // En app som lämnar toppen säger inget: den kan ha legat kvar sedan före omstarten.
    const gone = logs.parseBattery(['                    0 (17) START', '                    0 (19) TIME: 2026-05-25-12-50-29', '            +10s000ms (2) 100 -top=u0a98:"org.example.chat"'].join('\n'), 'newbatterystats260525130100');
    assert.deepStrictEqual(gone.unlocks, []);
    // En fil som fortsätter mitt i en start: läget på första raden räknas.
    const q = logs.parseBattery(['  05-26 08:00:00.000 RESET:TIME: 2026-05-26-08-00-00-000', '  05-26 08:00:00.001 100 80000000 top=u0a96:"com.sec.android.app.launcher"'].join('\n'), 'newbatterystats260526090000');
    assert.deepStrictEqual(q.boots, []);
    assert.strictEqual(q.unlocks[0].localMs, L(2026, 5, 26, 8, 0, 0, 1));
});

test('batterihistoriken: en start eller upplåsning med en gammal klocka får första tiden att lita på', () => {
    const p = logs.parseBattery([
        '                    0 (19) TIME: 2026-01-26-23-00-00',
        '            +10s000ms (2) 100 +top=u0a96:"com.sec.android.app.launcher"',
        '            +20s000ms (17) SHUTDOWN',
        '            +20s001ms (17) START',
        '            +20s002ms (19) TIME: 2021-01-01-13-07-36',
        '            +30s000ms (17) SHUTDOWN',
        '            +30s001ms (17) START',
        '            +30s002ms (19) TIME: 2023-10-17-05-29-16',
        '            +40s000ms (2) 100 +top=u0a96:"com.sec.android.app.launcher"',
        '            +50s000ms (19) TIME: 2026-02-10-09-54-48',
    ].join('\n'), 'newbatterystats260210100000');
    assert.deepStrictEqual(p.boots.map((b) => [b.localMs, b.line]), [[L(2026, 2, 10, 9, 54, 48), 10]], 'en start, med tiden när klockan ställts');
    assert.deepStrictEqual(p.unlocks.map((u) => [u.localMs, u.line]), [[L(2026, 1, 26, 23, 0, 10), 2], [L(2026, 2, 10, 9, 54, 48), 10]], 'upplåsningen med fel klocka står på samma tid, så den ger inget spann');
});

test('läget: omstart, inte upplåst till första appen, och sedan igång', () => {
    const e = err([REBOOT('2026-04-24 19:46:27', 'device_locked_3days'), ON('2026-04-24 19:47:15')]);
    const boot = { ms: L(2026, 4, 24, 17, 46, 58), file: 'b', line: 9, raw: 'TIME' };
    const open = { ms: L(2026, 4, 27, 6, 53, 4), file: 'b', line: 90, raw: '+top', via: 'batterihistoriken', app: 'launcher' };
    const got = spansOf(e, { boots: [boot], unlocks: [open] });
    assert.deepStrictEqual(spanKinds(got), ['off', 'bfu', 'on']);
    assert.deepStrictEqual(got.map((s) => [s.startMs, s.endMs]), [[e.rows[0].ms, boot.ms], [boot.ms, open.ms], [open.ms, null]]);
    assert.strictEqual(got[1].on.what, 'ON');
    assert.strictEqual(got[2].endUnknown, false);
});

test('läget: ON-raden kan komma efter upplåsningen, och då slutar avstängd och inte upplåst där batterihistorikens rader säger', () => {
    const e = err([REBOOT('2026-02-10 13:11:23', 'shell'), ON('2026-02-10 14:53:31'), REBOOT('2026-02-10 15:00:00', 'shell')]);
    const boot = { ms: e.rows[0].ms + 28000, file: 'b', line: 9, raw: 'TIME' };
    const open = { ms: e.rows[1].ms - 9000, file: 'b', line: 90, raw: '+top', via: 'batterihistoriken', app: 'launcher' };
    const got = spansOf(e, { boots: [boot], unlocks: [open] });
    assert.deepStrictEqual(spanKinds(got), ['off', 'bfu', 'on', 'unsure/end']);
    assert.strictEqual(got[0].endMs, boot.ms);
    assert.strictEqual(got[1].endMs, open.ms);
    assert.strictEqual(got[2].endMs, e.rows[2].ms);
    // Utan raden om starten ska tecknet före ON-raden ändå säga att telefonen var upplåst, också när ett senare tecken finns.
    const later = { ms: e.rows[1].ms + 100000, file: 'c', line: 1, raw: 'top', via: 'batterihistoriken', app: 'launcher' };
    const noBoot = spansOf(e, { unlocks: [open, later], covered: () => false });
    assert.deepStrictEqual(spanKinds(noBoot), ['unsure/battery', 'on', 'unsure/end']);
    const noBoot2 = spansOf(e, { unlocks: [open, later] });
    assert.deepStrictEqual(spanKinds(noBoot2), ['off', 'on', 'unsure/end'], 'tecknet före ON-raden gäller, inte det senare');
});

test('läget: avstängd kräver att batterihistoriken täcker tiden, en start emellan och inga rader med fel klocka', () => {
    const e = err([OFF('2026-03-01 10:00:00', 'userrequested'), ON('2026-03-12 10:00:00')]);
    assert.deepStrictEqual(spanKinds(spansOf(e)), ['off', 'on']);
    assert.deepStrictEqual(spanKinds(spansOf(e, { covered: () => false })), ['unsure/battery', 'on']);
    let asked = null;
    spansOf(e, { covered: (a, b) => { asked = asked || [a, b]; return true; } });
    assert.deepStrictEqual(asked, [e.rows[0].ms, e.rows[1].ms], 'hela tiden frågas');

    const lost = err([OFF('2026-01-27 00:05:24', 'no power'), OFF('2023-10-12 16:49:57', 'no power'), ON('2026-02-10 10:07:14')]);
    const withLost = spansOf(lost);
    assert.deepStrictEqual(spanKinds(withLost), ['unsure/clock', 'on']);
    assert.strictEqual(withLost[0].lost.length, 1);

    const twice = err([REBOOT('2025-12-04 14:38:35', 'shell'), OFF('2025-12-12 00:40:21', 'no power'), ON('2025-12-12 12:30:26')]);
    assert.deepStrictEqual(spanKinds(spansOf(twice)), ['unsure/row', 'off', 'on']);

    assert.deepStrictEqual(spanKinds(spansOf(err([OFF('2026-03-01 10:00:00', 'userrequested')]))), ['unsure/end']);

    // Rader med fel klocka säger bara något om spannet de står i.
    const elsewhere = err([OFF('2026-01-27 00:05:24', 'no power'), OFF('2023-10-12 16:49:57', 'no power'), ON('2026-02-10 10:07:14'), OFF('2026-03-01 10:00:00', 'userrequested'), ON('2026-03-12 10:00:00')]);
    assert.deepStrictEqual(spanKinds(spansOf(elsewhere)), ['unsure/clock', 'on', 'off', 'on']);
});

test('läget: en start utan nedstängning före säger inte när telefonen gick ner, och en rad som bara handlar om laddning ändrar inget', () => {
    const e = err([ON('2022-07-02 16:39:30'), ON('2025-11-13 09:49:17', 'KP'), OFF('2025-12-12 00:40:21', 'no power'), '2025-12-12 10:20:00+0000 |   LPM    |', ON('2025-12-12 12:30:26')]);
    const got = spansOf(e);
    assert.deepStrictEqual(spanKinds(got), ['on', 'on', 'off', 'on']);
    assert.strictEqual(got[0].endUnknown, true);
    assert.strictEqual(got[1].endUnknown, false);
    assert.strictEqual(got[2].endMs, e.rows[4].ms, 'LPM-raden avslutar inget');
});

test('läget: tecknet på upplåsning måste höra till samma start, och bevisa att ingen upplåsning kom före', () => {
    const e = err([REBOOT('2026-08-07 10:00:00', 'shell')]);
    const b1 = { ms: L(2026, 8, 7, 8, 1, 0), file: 'b', line: 1, raw: 'TIME' };
    const b2 = { ms: L(2026, 8, 7, 8, 30, 0), file: 'b', line: 2, raw: 'TIME' };
    const after = { ms: L(2026, 8, 7, 9, 0, 0), file: 'b', line: 3, raw: '+top', via: 'batterihistoriken', app: 'launcher' };
    const got = spansOf(e, { boots: [b1, b2], unlocks: [after] });
    assert.deepStrictEqual(spanKinds(got), ['off', 'on', 'bfu', 'on'], 'den första starten har inget tecken, så den sägs inte vara utan upplåsning');
    assert.strictEqual(got[1].endUnknown, true);

    // Batterihistoriken med ett hål från starten till tecknet bevisar inget. SSRM:s START är en egen rad och gör det.
    const hole = (a, b) => !(a === b1.ms && b === after.ms);
    assert.deepStrictEqual(spanKinds(spansOf(e, { boots: [b1], unlocks: [after], covered: hole })), ['off', 'on']);
    const start = { ms: after.ms, file: 's', line: 1, raw: 'START', via: 'SSRM' };
    assert.deepStrictEqual(spanKinds(spansOf(e, { boots: [b1], unlocks: [start], covered: hole })), ['off', 'bfu', 'on']);
    // SSRM-rader före START: SSRM har startat om, och telefonen var redan upplåst.
    const rows = [{ startMs: b1.ms + 60000 }, { startMs: after.ms }];
    assert.deepStrictEqual(spanKinds(spansOf(e, { boots: [b1], unlocks: [start], covered: hole, ssrmSpans: rows })), ['off', 'on']);
});

test('läget i fönstren: texter, rader, de tre låsta dygnen och skärmen före upplåsningen', () => {
    const e = err([ON('2026-04-21 19:38:51', 'NP'), REBOOT('2026-04-24 19:46:27', 'device_locked_3days'), ON('2026-04-24 19:47:15'), OFF('2026-05-01 10:00:00', 'okänd_orsak')]);
    const boot = { ms: L(2026, 4, 24, 17, 46, 58), file: 'newbatterystats1', line: 9, raw: 'TIME: x' };
    const open = { ms: L(2026, 4, 27, 6, 53, 4), file: 'newbatterystats2', line: 90, raw: '+top', via: 'batterihistoriken', app: 'launcher' };
    const opts = { err: e, boots: [boot], unlocks: [open], covered: () => true, ssrmSpans: [] };
    const reboot = e.rows[1].ms;

    const inBfu = logs.collectPower(Object.assign({ windows: [{ startMs: L(2026, 4, 25, 12), endMs: L(2026, 4, 25, 13) }] }, opts));
    assert.deepStrictEqual(inBfu.spans.map((s) => s.kind), ['bfu']);
    assert.ok(inBfu.spans[0].startText.includes('batterihistoriken: START, newbatterystats1 rad 9'), inBfu.spans[0].startText);
    assert.ok(inBfu.spans[0].endText.includes('första appen efter starten, launcher'), inBfu.spans[0].endText);
    assert.deepStrictEqual(inBfu.rows, [], 'inga rader i fönstret');
    assert.strictEqual(inBfu.locks.length, 1);
    assert.ok(inBfu.locks[0].notUnlocked && inBfu.locks[0].locked && inBfu.locks[0].plain === null && inBfu.locks[0].plainEnd === 'Telefonen låses upp första gången');

    const before = logs.collectPower(Object.assign({ windows: [{ startMs: reboot - 3600000, endMs: reboot + 600000 }] }, opts));
    assert.deepStrictEqual(before.rows.map((r) => r.what), ['REBOOT', 'ON']);
    assert.ok(/Telefonen startar om \(eRR\.p: REBOOT, device_locked_3days \(låst i tre dygn\)\)/.test(before.rows[0].text), before.rows[0].text);
    assert.strictEqual(before.rows[0].plain, 'Telefonen startar om: låst i tre dygn');
    assert.deepStrictEqual(before.rows[0].source, { db: 'eRR.p', table: 'eRR.p rad 6', column: e.rows[1].raw, queryId: 'err-p' });
    assert.deepStrictEqual(before.spans.map((s) => s.kind), ['on', 'off', 'bfu']);
    const three = before.locks.find((l) => l.threeDays);
    assert.deepStrictEqual([three.startMs, three.endMs, three.plain, three.plainEnd], [reboot - 72 * 3600000, reboot, 'Telefonen låses', null]);

    // Tre dygn före omstarten är telefonen låst, och fönstret där har bara det.
    const third = logs.collectPower(Object.assign({ windows: [{ startMs: reboot - 40 * 3600000, endMs: reboot - 39 * 3600000 }] }, opts));
    assert.deepStrictEqual(third.locks.map((l) => !!l.threeDays), [true]);
    assert.deepStrictEqual(logs.collectPower(Object.assign({ windows: [{ startMs: reboot - 73 * 3600000, endMs: reboot - 72 * 3600000 - 1000 }] }, opts)).locks, [], 'före de tre dygnen');

    // En rad med fel klocka är ingen händelse, inte ens i ett fönster på den tiden.
    const wrong = err([ON('2026-04-21 19:38:51'), REBOOT('2023-10-12 16:49:57', 'shell')]);
    const wrongTime = wrong.rows[1].ms;
    assert.deepStrictEqual(logs.collectPower({ err: wrong, boots: [], unlocks: [], covered: () => true, ssrmSpans: [], windows: [{ startMs: wrongTime - 1000, endMs: wrongTime + 1000 }] }).rows, []);

    // En orsak utan ord står som den är.
    const unknown = logs.collectPower(Object.assign({ windows: [{ startMs: e.rows[3].ms - 1000, endMs: e.rows[3].ms + 1000 }] }, opts));
    assert.ok(/eRR\.p: SHUTDOWN, okänd_orsak\)/.test(unknown.rows[0].text), unknown.rows[0].text);
    assert.strictEqual(unknown.rows[0].plain, 'Telefonen stängs av');

    // Skärmen före upplåsningen är ingen app, och Inställningar efter den är det.
    const span = inBfu.spans[0];
    const rows = [
        { app: 'com.android.settings', stream: 'batterihistoriken', startMs: span.startMs + 10000, endMs: span.endMs },
        { app: 'com.android.settings', stream: 'batterihistoriken', startMs: span.endMs + 100000, endMs: span.endMs + 200000 },
        { app: 'com.android.settings', stream: 'SSRM', startMs: span.startMs + 10000, endMs: span.endMs },
        { app: 'org.example.chat', stream: 'batterihistoriken', startMs: span.startMs + 10000, endMs: span.endMs },
    ];
    assert.deepStrictEqual(logs.dropFallbackHome(rows, inBfu.spans), rows.slice(1));
    assert.deepStrictEqual(logs.dropFallbackHome(rows, []), rows);
});

test('läget: bara det som behövs läses, och täckningen frågas utan hål', () => {
    const e = err([ON('2026-01-01 10:00:00'), REBOOT('2026-02-01 10:00:00', 'shell'), ON('2026-02-01 10:01:00'), ON('2026-03-01 10:00:00', 'KP'), REBOOT('2026-04-01 10:00:00', 'shell')]);
    const at = (t) => [{ startMs: t, endMs: t + 60000 }];
    assert.deepStrictEqual(logs.powerRange(e, at(L(2026, 3, 15))), [{ startMs: e.rows[1].ms, endMs: e.rows[4].ms }], 'från senaste nedstängningen, förbi kraschen, till nästa rad');
    assert.deepStrictEqual(logs.powerRange(e, at(L(2025, 1, 1))), [{ startMs: L(2025, 1, 1), endMs: e.rows[0].ms + 0 }]);
    assert.deepStrictEqual(logs.powerRange(e, at(L(2026, 5, 1))), [{ startMs: e.rows[4].ms, endMs: L(2026, 5, 1) + 60000 }]);
    const cov = { firstMs: 100, lastMs: 1000, gaps: [{ startMs: 400, endMs: 500 }] };
    assert.ok(logs.batteryCovers(cov, 100, 400));
    assert.ok(logs.batteryCovers(cov, 500, 1000));
    assert.ok(!logs.batteryCovers(cov, 300, 450));
    assert.ok(!logs.batteryCovers(cov, 99, 200));
    assert.ok(!logs.batteryCovers(cov, 900, 1001));
    assert.ok(!logs.batteryCovers(null, 100, 200));
});

test('läget: batterihistorikens tider får eRR.p:s zon när raderna runt om säger samma, och klockans fel blir marginal', () => {
    const e = err([ON('2026-03-19 10:00:00'), ON('2026-03-19 13:00:00')].map((r) => r.replace('+0200', '+0100')));
    const p = logs.parseBattery(['                    0 (17) START', '                    0 (19) TIME: 2026-03-19-11-00-00', '            +10s000ms (2) 100 +top=u0a96:"com.sec.android.app.launcher"'].join('\n'), 'newbatterystats260521101855');
    // Filen skrevs i maj, med en annan zon än raderna i mars.
    const zones = logs.batteryZones([{ name: 'data/log/batterystats/newbatterystats260319080000', mtimeMs: L(2026, 3, 19, 7) }, { name: 'data/log/batterystats/newbatterystats260521101855', mtimeMs: L(2026, 5, 21, 8, 18, 55) }], []);
    assert.strictEqual(zones.newbatterystats260521101855.offsetMinutes, 120);
    const ev = logs.powerEvidence({ err: e, battery: [p], zones });
    assert.strictEqual(ev.boots[0].ms, L(2026, 3, 19, 10, 0, 0), 'zonen ur eRR.p, inte filens');
    assert.strictEqual(ev.boots[0].zoneMs, 0);
    assert.strictEqual(ev.unlocks[0].ms, L(2026, 3, 19, 10, 0, 10));
    assert.strictEqual(ev.unlocks[0].via, 'batterihistoriken');
    // Zonen byts mellan raderna runt om: filens zon gäller, och skillnaden blir marginal.
    const change = err(['2026-03-19 10:00:00+0100 |    ON    | RP    | A [1]', '2026-04-21 19:38:51+0200 |    ON    | RP    | A [1]']);
    const q = logs.parseBattery(['                    0 (17) START', '                    0 (19) TIME: 2026-04-01-11-00-00'].join('\n'), 'newbatterystats260521101855');
    const ev2 = logs.powerEvidence({ err: change, battery: [q], zones });
    assert.strictEqual(ev2.boots[0].ms, L(2026, 4, 1, 9, 0, 0));
    assert.strictEqual(ev2.boots[0].zoneMs, 3600000);
    // SSRM:s START har zonen ur [RTC].
    const ssrm = logs.parseSsrm([{ name: 'ssrm_heating_0.log', text: [rtc('2026-05-22 10:00:00', '2026-05-22 08:00:00'), '2026-05-22 11:47:57 [VER] A000XXU1 START'].join('\n') }]);
    const ev3 = logs.powerEvidence({ err: e, battery: [], zones: {}, ssrm });
    assert.deepStrictEqual(ev3.unlocks.map((u) => [u.ms, u.via, u.line]), [[L(2026, 5, 22, 9, 47, 57), 'SSRM', 2]]);
});

test('täckningen: ett byte av zon mellan två filer är inget hål', () => {
    const list = [{ name: 'data/log/batterystats/newbatterystats261009082142', mtimeMs: L(2026, 10, 9, 6, 21, 42) }, { name: 'data/log/batterystats/newbatterystats261106145528', mtimeMs: L(2026, 11, 6, 13, 55, 28) }];
    const zones = logs.batteryZones(list, []);
    const after = logs.parseBattery('  10-09 08:21:43.000 RESET:TIME: 2026-10-09-08-21-43-000\n  10-09 08:21:44.000 100 80000000 +screen', 'newbatterystats261106145528');
    const before = logs.parseBattery('  10-09 08:00:00.000 RESET:TIME: 2026-10-09-08-00-00-000', 'newbatterystats261009082142');
    assert.deepStrictEqual(logs.batteryCoverage(list, zones, { newbatterystats261009082142: before, newbatterystats261106145528: after }).gaps, []);
    // Ett riktigt hål står kvar.
    const late = logs.parseBattery('  10-09 09:30:00.000 RESET:TIME: 2026-10-09-09-30-00-000', 'newbatterystats261106145528');
    assert.strictEqual(logs.batteryCoverage(list, zones, { newbatterystats261009082142: before, newbatterystats261106145528: late }).gaps.length, 1);
});

// ---------- Telefonens zon ----------

// persistent_properties: en post per egenskap (fält 1) med namnet i fält 1 och värdet i fält 2.
const props = (records) => {
    const varint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
    const str = (no, s) => [(no << 3) | 2, ...varint(Buffer.byteLength(s)), ...Buffer.from(s)];
    const bytes = [];
    records.forEach(([k, v]) => { const inner = [...str(1, k), ...str(2, v)]; bytes.push((1 << 3) | 2, ...varint(inner.length), ...inner); });
    return Uint8Array.from(bytes);
};
const STHLM = logs.zoneRules('Europe/Stockholm');

test('telefonens zon: persist.sys.timezone ur persistent_properties, och filen hittas', () => {
    assert.strictEqual(logs.readZoneProperty(props([['persist.sys.locale', 'sv-SE'], ['persist.sys.timezone', 'Europe/Stockholm'], ['persist.sys.usb.config', 'mtp']])), 'Europe/Stockholm');
    assert.strictEqual(logs.readZoneProperty(props([['persist.sys.locale', 'sv-SE']])), null);
    assert.strictEqual(logs.readZoneProperty(props([['persist.sys.timezone', '<b>x</b>']])), null, 'inget zonnamn');
    assert.strictEqual(logs.readZoneProperty(Uint8Array.from([0x0a, 0xff, 0xff, 0x01, 0x02])), null, 'trasig fil');
    assert.strictEqual(logs.readZoneProperty(new Uint8Array(0)), null);
    assert.ok(logs.keeper()('data/property/persistent_properties'));
    assert.strictEqual(logs.sortEntries([{ name: 'Dump/data/property/persistent_properties' }]).props.name, 'Dump/data/property/persistent_properties');
});

test('telefonens zon: skiftena, timmen som går två gånger och timmen som hoppas över', () => {
    const in2026 = STHLM.shifts.filter((s) => s.utcMs >= L(2026, 1, 1) && s.utcMs < L(2027, 1, 1)).map((s) => [s.utcMs, s.before, s.after]);
    assert.deepStrictEqual(in2026, [[L(2026, 3, 29, 1), 60, 120], [L(2026, 10, 25, 1), 120, 60]]);
    assert.deepStrictEqual(STHLM.candidates(L(2026, 7, 1, 12)), [L(2026, 7, 1, 10)]);
    assert.deepStrictEqual(STHLM.candidates(L(2026, 12, 1, 12)), [L(2026, 12, 1, 11)]);
    assert.deepStrictEqual(STHLM.candidates(L(2026, 10, 25, 2, 30)), [L(2026, 10, 25, 0, 30), L(2026, 10, 25, 1, 30)]);
    assert.deepStrictEqual(STHLM.candidates(L(2026, 3, 29, 2, 30)), []);
    assert.strictEqual(logs.zoneRules('Mars/Olympus_Mons'), null);
    assert.strictEqual(logs.zoneRules(null), null);
    // Raderna i skrivordning: tiden går bakåt in i timmen, och då är det andra varvet.
    const read = logs.clockReader(STHLM);
    const got = [L(2026, 10, 25, 1, 59), L(2026, 10, 25, 2, 58), L(2026, 10, 25, 2, 59, 50), L(2026, 10, 25, 2, 0, 10), L(2026, 10, 25, 2, 30), L(2026, 10, 25, 3, 10)].map(read).map((r) => [r.ms, r.twice]);
    assert.deepStrictEqual(got, [
        [L(2026, 10, 24, 23, 59), false], [L(2026, 10, 25, 0, 58), true], [L(2026, 10, 25, 0, 59, 50), true],
        [L(2026, 10, 25, 1, 0, 10), false], [L(2026, 10, 25, 1, 30), false], [L(2026, 10, 25, 2, 10), false],
    ]);
});

// Den nyare formen skriver varje rad med förskjutningen vid sin tid: 02:59:50 följs av 02:00:10 när sommartiden slutar.
const FALL_NAME = 'newbatterystats261026120000';
const FALL = [
    '  10-25 01:30:00.000 RESET:TIME: 2026-10-25-01-30-00-000',
    '  10-25 01:30:01.000 100 c0 +screen',
    '  10-25 02:58:00.000 100 c0 +top=u0a1:"com.example.one"',
    '  10-25 02:59:50.000 100 c0 -top=u0a1:"com.example.one"',
    '  10-25 02:00:10.000 100 c0 +top=u0a2:"com.example.two"',
    '  10-25 02:30:00.000 100 c0 -top=u0a2:"com.example.two"',
    '  10-25 03:10:00.000 100 c0 -screen',
].join('\n');
const FALL_FILES = [
    { name: 'data/log/batterystats/newbatterystats261020120000', mtimeMs: L(2026, 10, 20, 10) },
    { name: 'data/log/batterystats/' + FALL_NAME, mtimeMs: L(2026, 10, 26, 11) },
];

test('batterihistoriken med telefonens zon: raderna över sommartidens slut får rätt UTC', () => {
    const p = logs.parseBattery(FALL, FALL_NAME, { rules: STHLM });
    assert.strictEqual(p.rules, 'Europe/Stockholm');
    assert.deepStrictEqual(p.apps.map((a) => [a.app, a.startUtc, a.endUtc, !!(a.startTwice || a.endTwice)]), [
        ['com.example.one', L(2026, 10, 25, 0, 58), L(2026, 10, 25, 0, 59, 50), true],
        ['com.example.two', L(2026, 10, 25, 1, 0, 10), L(2026, 10, 25, 1, 30), false],
    ]);
    const lit = p.screen.filter((s) => s.on);
    assert.deepStrictEqual(lit.map((s) => [s.startUtc, s.endUtc]), [[L(2026, 10, 24, 23, 30, 1), L(2026, 10, 25, 2, 10)]], 'två timmar och fyrtio minuter, fast klockan bara visar en timme och fyrtio');
    // I fönstret: med zonen är bara raden i första varvet osäker. Utan den är hela filen det, eftersom den spänner över bytet.
    const w = [{ startMs: L(2026, 10, 24), endMs: L(2026, 10, 26) }];
    const zones = logs.batteryZones(FALL_FILES, [], STHLM);
    assert.ok(zones[FALL_NAME].rules && zones.newbatterystats261020120000.rules);
    const got = logs.collect({ windows: w, battery: [p], zones, primary: [], rules: STHLM });
    assert.deepStrictEqual(got.apps.map((a) => [a.app, a.startMs]), [['com.example.two', L(2026, 10, 25, 1, 0, 10)]]);
    assert.deepStrictEqual(got.unsure.map((u) => [u.app, u.zoneMs]), [['com.example.one', 3600000]]);
    assert.deepStrictEqual(got.screen.filter((s) => s.on).map((s) => [s.startMs, s.endMs]), [[L(2026, 10, 24, 23, 30, 1), L(2026, 10, 25, 2, 10)]]);
    const old = logs.collect({ windows: w, battery: [logs.parseBattery(FALL, FALL_NAME)], zones: logs.batteryZones(FALL_FILES, []), primary: [] });
    assert.strictEqual(old.apps.length + old.screen.length, 0);
    assert.ok(old.unsure.length >= 3 && old.unsure.every((u) => u.zoneMs === 3600000));
});

test('ingen logg säger zonen: med telefonens zon som antagande visas raderna men räknas inte, och utan den används de inte', () => {
    // SSRM utan en enda rad [RTC], och en batterifil utan ändringstid: inget i loggarna säger vilken zon tiderna står i.
    const text = SSRM_A.split('\n').filter((l) => !/\[RTC\]/.test(l)).join('\n');
    const files = [{ name: 'data/log/batterystats/newbatterystats260930083000', mtimeMs: null }];
    const name = 'newbatterystats260930083000';
    const day = [{ startMs: L(2026, 5, 22), endMs: L(2026, 5, 23) }, { startMs: L(2026, 9, 30), endMs: L(2026, 10, 1) }];

    const zones = logs.batteryZones(files, [], STHLM);
    assert.deepStrictEqual([zones[name].offsetMinutes, zones[name].rules, zones[name].assumed.name], [null, null, 'Europe/Stockholm']);
    const ssrm = logs.parseSsrm([{ name: 'ssrm_heating_5.log', text }], { rules: STHLM });
    assert.deepStrictEqual(ssrm.offsets, []);
    const battery = logs.parseBattery(CLOCK, name, { rules: zones[name].assumed });
    const got = logs.collect({ windows: day, ssrm, battery: [battery], zones, primary: [], rules: STHLM });
    assert.deepStrictEqual([got.apps, got.screen, got.camera, got.noZone], [[], [], [], 0], 'inget räknas, och inget tappas');
    assert.ok(got.unsure.length > 0 && got.unsure.every((u) => u.assumed === 'Europe/Stockholm'));
    assert.deepStrictEqual([got.assumed, got.assumedZone], [got.unsure.length, 'Europe/Stockholm']);
    // Tiderna är räknade med sommartid i Stockholm, två timmar före UTC.
    const cam = got.unsure.filter((u) => u.what === 'camera' && u.stream === 'SSRM');
    assert.deepStrictEqual(cam.map((c) => [c.app, c.startMs, c.endMs]).slice(0, 1), [['org.example.chat', L(2026, 5, 22, 10, 24, 57), L(2026, 5, 22, 10, 25, 0)]]);
    const lit = got.unsure.filter((u) => u.what === 'screen' && u.on && u.stream === 'batterihistoriken');
    assert.ok(lit.some((s) => s.startMs === L(2026, 9, 30, 6, 22, 31)), JSON.stringify(lit.map((s) => s.startMs)));
    assert.ok(got.usedSsrm['ssrm_heating_5.log'] && got.usedBattery[name], 'råraderna står i bilagan');
    // Täckningen bygger inte på antagandet: att loggen saknar en rad får inte bli ett besked.
    const sCov = logs.ssrmCoverage(ssrm, STHLM), bCov = logs.batteryCoverage(files, zones, { [name]: battery });
    assert.deepStrictEqual([sCov.firstMs, sCov.noZone, bCov.firstMs, bCov.noZone], [null, true, null, true]);
    assert.strictEqual(logs.ssrmCoverage(logs.parseSsrm([{ name: 'ssrm_heating_5.log', text: SSRM_A }], { rules: STHLM }), STHLM).noZone, undefined, 'en logg med zon säger inget om det');

    // Utan telefonens zon finns inget att anta.
    const bare = logs.collect({ windows: day, ssrm: logs.parseSsrm([{ name: 'ssrm_heating_5.log', text }]), battery: [logs.parseBattery(CLOCK, name)], zones: logs.batteryZones(files, []), primary: [] });
    assert.deepStrictEqual([bare.unsure, bare.assumed], [[], 0]);
    assert.ok(bare.noZone > 0);

    // En logg som själv visar zonen räknas som förut, också med telefonens zon känd.
    const known = logs.collect({ windows: day, ssrm: logs.parseSsrm([{ name: 'ssrm_heating_5.log', text: SSRM_A }], { rules: STHLM }), battery: [], zones: {}, primary: [], rules: STHLM });
    assert.deepStrictEqual([known.assumed, known.unsure.length], [0, 0]);
    assert.ok(known.camera.length > 0);
});

test('batterihistoriken med telefonens zon: i den äldre formen räknas raderna från ankarets UTC, och bytet är inget steg', () => {
    const text = [
        '                    0 (19) RESET:TIME: 2026-10-25-01-30-00',
        '          +1h00m00s000ms (1) 100 c0 +screen',
        '          +2h00m00s000ms (1) 100 c0 -screen',
        '          +2h30m00s000ms (19) TIME: 2026-10-25-03-00-00',
        '          +2h40m00s000ms (1) 100 c0 +screen',
    ].join('\n');
    const p = logs.parseBattery(text, FALL_NAME, { rules: STHLM });
    // Räknat från ankaret, 01:30 sommartid (23:30 UTC): skärmen tänds 00:30 UTC och släcks 01:30 UTC, när sommartiden slutat.
    assert.deepStrictEqual(p.screen.filter((s) => s.on).map((s) => [s.startUtc, s.endUtc, s.clockMs]), [[L(2026, 10, 25, 0, 30), L(2026, 10, 25, 1, 30), 0]]);
    assert.deepStrictEqual(p.segments.map((s) => [s.startUtc, s.endStep, s.clockMs]), [[L(2026, 10, 24, 23, 30), 0, 0], [L(2026, 10, 25, 2), null, 0]]);
    // Utan zonen ser ankaret ut att stega en timme bakåt, och avsnittet före blir osäkert.
    assert.strictEqual(logs.parseBattery(text, FALL_NAME).segments[0].clockMs, 3600000);
});

test('batterihistoriken med telefonens zon: vårens hopp vid ett ankare är ett uppehåll, inte en klocka som ställdes', () => {
    const text = [
        '  03-29 01:50:00.000 RESET:TIME: 2026-03-29-01-50-00-000',
        '  03-29 01:55:00.000 100 c0 +screen',
        '  03-29 03:05:00.000 TIME: 2026-03-29-03-05-00-000',
        '  03-29 03:05:00.100 100 c0 +running',
        '  03-29 03:06:00.000 100 c0 -screen',
    ].join('\n');
    const p = logs.parseBattery(text, 'newbatterystats260330120000', { rules: STHLM });
    assert.deepStrictEqual(p.segments.map((s) => [s.startStep, s.clockMs]), [[null, 0], [600000, 0]]);
    assert.deepStrictEqual(p.screen.filter((s) => s.on).map((s) => [s.startUtc, s.endUtc, s.clockMs]), [[L(2026, 3, 29, 0, 55), L(2026, 3, 29, 1, 6), 0]]);
    const old = logs.parseBattery(text, 'newbatterystats260330120000');
    assert.strictEqual(old.segments[0].clockMs, 4200000, 'utan zonen: 70 minuter, som en klocka som ställdes');
});

test('SSRM med telefonens zon: vårens hopp är inget hål, och zonen i [RTC] före och efter avgör', () => {
    const text = [
        rtc('2026-03-29 01:00:00', '2026-03-29 00:00:00'),
        '2026-03-29 01:58:00 [PKG] com.example.night',
        '2026-03-29 03:01:00 [PKG] com.example.morning',
        rtc('2026-03-29 03:02:00', '2026-03-29 01:02:00'),
        lcd('2026-03-29 03:05:00', 'OFF'),
    ].join('\n');
    const p = logs.parseSsrm([{ name: 'ssrm_heating_0.log', text }], { rules: STHLM });
    assert.deepStrictEqual(p.apps.map((a) => [a.app, a.startUtc, a.endUtc, !!a.openEnded]), [
        ['com.example.night', L(2026, 3, 29, 0, 58), L(2026, 3, 29, 1, 1), false],
        ['com.example.morning', L(2026, 3, 29, 1, 1), L(2026, 3, 29, 1, 5), false],
    ]);
    const w = [{ startMs: L(2026, 3, 28), endMs: L(2026, 3, 30) }];
    const got = logs.collect({ windows: w, ssrm: p, battery: [], zones: {}, primary: [], rules: STHLM });
    assert.deepStrictEqual(got.apps.map((a) => [a.app, a.startMs, a.endMs]), [
        ['com.example.night', L(2026, 3, 29, 0, 58), L(2026, 3, 29, 1, 1)], ['com.example.morning', L(2026, 3, 29, 1, 1), L(2026, 3, 29, 1, 5)],
    ]);
    assert.strictEqual(got.unsure.length, 0);
    assert.deepStrictEqual(logs.ssrmCoverage(p, STHLM).gaps, []);
    // Utan zonen: en timme och tre minuter mellan raderna är ett hål i loggen, och zonen däremellan är osäker.
    const old = logs.parseSsrm([{ name: 'ssrm_heating_0.log', text }]);
    assert.ok(old.apps[0].openEnded && old.apps[0].endLocal === old.apps[0].startLocal);
    assert.ok(logs.collect({ windows: w, ssrm: old, battery: [], zones: {}, primary: [] }).unsure.some((u) => u.zoneMs === 3600000));
});

test('telefonens zon: en zon i loggarna som inte stämmer gör att loggens egen zon gäller, och det sägs', () => {
    // En fil skriven i en annan zon, till exempel på en resa: zonens regler gäller inte den filen.
    const files = [{ name: 'data/log/batterystats/newbatterystats261201120000', mtimeMs: L(2026, 12, 1, 12) }, ...FALL_FILES];
    const zones = logs.batteryZones(files, [], STHLM);
    assert.strictEqual(zones.newbatterystats261201120000.rules, null);
    assert.strictEqual(zones.newbatterystats261201120000.offsetMinutes, 0);
    // SSRM: [RTC] säger UTC+00:00 under sommaren. Där gäller [RTC], som förut.
    const offsets = [{ localMs: L(2026, 7, 1, 10), offsetMinutes: 0 }, { localMs: L(2026, 7, 2, 10), offsetMinutes: 0 }];
    assert.deepStrictEqual(logs.ssrmZone(offsets, STHLM, L(2026, 7, 1, 12), L(2026, 7, 1, 10), false), { ms: L(2026, 7, 1, 12), unsureMs: 0 });
    const e = logs.parseErr(['2026-07-03 10:00:00+0200 | ON | RP |', '2026-07-04 10:00:00+0100 | ON | RP |'].join('\n'), 'eRR.p');
    const chk = logs.zoneCheck(STHLM, { err: e, ssrm: { offsets }, battery: files });
    assert.deepStrictEqual([chk.agree, chk.total], [3, 7]);
    assert.ok(chk.differ.some((t) => /^newbatterystats261201120000 säger UTC\+00:00, zonen UTC\+01:00$/.test(t)), chk.differ.join(' | '));
    assert.ok(chk.differ.some((t) => /^eRR\.p rad 2 säger UTC\+01:00, zonen UTC\+02:00$/.test(t)), chk.differ.join(' | '));
});
