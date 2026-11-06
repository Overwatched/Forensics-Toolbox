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
    assert.deepStrictEqual(p.offsets.map((o) => o.offsetMinutes), [120, 60]);
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
