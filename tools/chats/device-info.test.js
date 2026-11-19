'use strict';
// Telefonen: hemskärmen, appens namn och inställningarna ur telefonens egna filer. Raderna efterliknar de tre
// extraktionerna som tolkningen kontrollerades mot 2026-11-19 (iPhone iOS 26.4.1, Samsung A33 och Pixel 9a, Android 16).
const test = require('node:test');
const assert = require('node:assert');
const D = require('./device-info.js');
require('../ios-keychain/lib/bplist.js');
const { abxParse } = require('../provenance/android-logs.js');

const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

// Androids binära XML: <settings><setting id name value/>…</settings>, som telefonen skriver settings_global.xml.
function abxSettings(pairs) {
    const out = [0x41, 0x42, 0x58, 0x00];
    const strs = [];
    const u16 = (n) => { out.push((n >> 8) & 0xff, n & 0xff); };
    const intern = (s) => { const i = strs.indexOf(s); if (i >= 0) { u16(i); return; } strs.push(s); u16(0xffff); const b = Buffer.from(s, 'utf8'); u16(b.length); out.push(...b); };
    const utf = (s) => { const b = Buffer.from(s, 'utf8'); u16(b.length); out.push(...b); };
    out.push(0x00);
    out.push(0x02); intern('settings');
    pairs.forEach(([k, v]) => {
        out.push(0x02); intern('setting');
        out.push(0x2f); intern('name'); utf(k);
        out.push(0x2f); intern('value'); utf(v);
        out.push(0x03); intern('setting');
    });
    out.push(0x03); intern('settings');
    out.push(0x01);
    return new Uint8Array(out);
}

test('filerna känns igen på sökvägen, kopior och -wal sorteras rätt', () => {
    assert.deepStrictEqual(D.fileOf('filesystem1/private/var/mobile/Library/SpringBoard/IconState.plist'), { id: 'iconState', wal: false });
    assert.deepStrictEqual(D.fileOf('filesystem1/private/var/mobile/Library/Accounts/Accounts3.sqlite-wal'), { id: 'accountsIos', wal: true });
    assert.strictEqual(D.fileOf('filesystem1/private/var/mobile/Library/Accounts/VerifiedBackup/Accounts3.sqlite'), null);
    assert.strictEqual(D.fileOf('filesystem1/private/var/MobileAsset/AssetsV2/x/purpose_auto/a.asset/.AssetData/System/Library/CoreServices/SystemVersion.plist'), null);
    assert.deepStrictEqual(D.fileOf('filesystem1/System/Library/CoreServices/SystemVersion.plist'), { id: 'systemVersion', wal: false });
    assert.deepStrictEqual(D.fileOf('filesystem1/private/var/containers/Bundle/Application/665B33ED-C485-4AF1-AC55-FF2C6E43C2AB/Snapchat.app/Info.plist'), { id: 'appInfo', wal: false });
    assert.strictEqual(D.fileOf('filesystem1/private/var/containers/Bundle/Application/665B33ED-C485-4AF1-AC55-FF2C6E43C2AB/Snapchat.app/PlugIns/X.appex/Info.plist'), null);
    assert.deepStrictEqual(D.fileOf('Dump/data/data/com.sec.android.app.launcher/databases/OneUI.db'), { id: 'oneUi', wal: false });
    assert.deepStrictEqual(D.fileOf('/data/data/com.google.android.apps.nexuslauncher/databases/launcher_4_by_5.db'), { id: 'launcher3', wal: false });
    assert.deepStrictEqual(D.fileOf('Dump/data/system/users/0/wallpaper'), { id: 'wallpaper', wal: false });
    assert.deepStrictEqual(D.fileOf('Dump/data/system/users/0/wallpaper_lock'), { id: 'wallpaperLock', wal: false });
    assert.strictEqual(D.fileOf('Dump/data/system/users/0/wallpaper_lock_images/wallpaper_first'), null);
    assert.deepStrictEqual(D.fileOf('Dump/system/build.prop'), { id: 'buildProp', wal: false });
    assert.deepStrictEqual(D.fileOf('/product/etc/build.prop'), { id: 'buildProp', wal: false });
    assert.strictEqual(D.fileOf('Dump/data/data/x/files/system/build.prop'), null);
    const got = D.pick([
        { name: 'Dump/data/data/com.sec.android.app.launcher/databases/OneUI.db' },
        { name: 'Dump/data/data/com.sec.android.app.launcher/databases/OneUI.db-wal' },
        { name: 'Dump/data/user/0/com.sec.android.app.launcher/databases/OneUI.db' },
        { name: 'Dump/system/build.prop' }, { name: 'Dump/vendor/build.prop' },
    ]);
    assert.strictEqual(got.oneUi.length, 1);
    assert.strictEqual(got.oneUi[0].wal.name, 'Dump/data/data/com.sec.android.app.launcher/databases/OneUI.db-wal');
    assert.strictEqual(got.buildProp.length, 2);
});

test('plist i XML: ordbok, lista, tal, sant och falskt, datum och tecken', () => {
    const x = D.xmlPlist('<?xml version="1.0"?><plist version="1.0"><dict><key>ProductVersion</key><string>26.4.1</string><key>n</key><integer>3</integer>' +
        '<key>ok</key><true/><key>raw</key><data>TGFiYm7DpHRldA==</data><key>list</key><array><string>a &amp; b</string><dict/></array><key>t</key><date>2026-11-19T07:00:00Z</date></dict></plist>');
    assert.deepStrictEqual(x.list, ['a & b', {}]);
    assert.strictEqual(x.ProductVersion, '26.4.1');
    assert.strictEqual(x.n, 3);
    assert.strictEqual(x.ok, true);
    assert.strictEqual(Buffer.from(x.raw).toString('utf8'), 'Labbnätet', 'data blir bytes');
    assert.strictEqual(D.nsMs(x.t), Date.UTC(2026, 10, 19, 7));
});

test('iOS-hemskärmen: sidor, widgetar som tar plats, en mapp och dockan, i IconState.plists ordning', () => {
    const icon = {
        iconLists: [
            [{ elements: [{ containerBundleIdentifier: 'com.apple.weather', widgetIdentifier: 'com.apple.weather' }], gridSize: 'small', iconType: 'custom' },
                { elements: [{ containerBundleIdentifier: 'com.apple.mobilecal' }, { containerBundleIdentifier: 'com.apple.mobileslideshow' }], gridSize: 'small' },
                'com.apple.facetime', 'com.apple.mobilecal', 'com.apple.mobileslideshow', 'com.apple.camera', 'com.apple.mobilemail'],
            ['com.toyopagroup.picaboo', { displayName: 'Verktyg', iconLists: [['com.apple.calculator', 'com.apple.compass']], listType: 'folder' }, { medium: true }],
        ],
        buttonBar: ['com.apple.mobilephone', 'com.google.chrome.ios', 'com.apple.MobileSMS', 'com.apple.Music'],
    };
    const h = D.iosHome(icon, (id) => D.appName(id, { 'com.toyopagroup.picaboo': 'Snapchat' }, [{ name: 'Chrome', ios: { bundleId: 'com.google.chrome.ios' } }]));
    assert.strictEqual(h.pages.length, 2);
    assert.deepStrictEqual(h.pages[0].map((c) => [c.item.name || c.item.app, c.x, c.y, c.w, c.h]), [
        ['Väder', 0, 0, 2, 2], ['Kalender', 2, 0, 2, 2], ['FaceTime', 0, 2, 1, 1], ['Kalender', 1, 2, 1, 1], ['Bilder', 2, 2, 1, 1], ['Kamera', 3, 2, 1, 1], ['Mail', 0, 3, 1, 1]]);
    assert.strictEqual(h.pages[0][1].item.count, 2);
    assert.deepStrictEqual(h.pages[1].map((c) => c.item.kind + ':' + c.item.name), ['app:Snapchat', 'folder:Verktyg']);
    assert.deepStrictEqual(h.pages[1][1].item.items.map((x) => x.name), ['Kalkylator', 'Kompass']);
    assert.strictEqual(h.unread, 1, 'en okänd post räknas');
    assert.deepStrictEqual(h.dock.map((d) => d.name), ['Telefon', 'Chrome', 'Meddelanden', 'Musik']);
    assert.deepStrictEqual(D.homeAppIds(h).filter((x) => /mappen/.test(x.where)).map((x) => x.id + ' @ ' + x.where), ['com.apple.calculator @ sida 2, mappen Verktyg', 'com.apple.compass @ sida 2, mappen Verktyg']);
    assert.strictEqual(D.roleOf('com.toyopagroup.picaboo'), 'Snapchat');
    assert.strictEqual(D.roleOf('com.apple.Preferences'), 'Inställningar');
});

test('One UI (Samsung): sidorna under hemskärmen, platserna, en mapp, widgetens storlek och dockan', () => {
    const groups = [
        { id: 1, type: 'homescreen', container_id: -10, rank: 0 }, { id: 2, type: 'workspace', container_id: 1, rank: 0 },
        { id: 3, type: 'page', container_id: 2, rank: 0 }, { id: 4, type: 'page', container_id: 2, rank: 1 }, { id: 5, type: 'hotseat', container_id: 1, rank: 0 },
        { id: 6, type: 'appscreen', container_id: -10, rank: 0 }, { id: 7, type: 'applist', container_id: 6, rank: 0 }, { id: 8, type: 'page', container_id: 7, rank: 0 },
    ];
    const items = [
        { id: 2, type: 'widget', title: null, component: 'com.sec.android.daemonapp/.appwidget.WeatherAppWidget2x1', spanX: 2, spanY: 2, position_x: 0, position_y: 1, container_type: 0, container_id: 3, hidden: 0 },
        { id: 31, type: 'app', title: 'Signal', component: 'org.thoughtcrime.securesms/.RoutingActivity', spanX: -1, spanY: -1, position_x: 0, position_y: 4, container_type: 0, container_id: 3, hidden: 0 },
        { id: 8, type: 'folder', title: 'Google', component: null, spanX: -1, spanY: -1, position_x: 3, position_y: 5, container_type: 0, container_id: 3, hidden: 0 },
        { id: 75, type: 'app', title: 'Chrome', component: 'com.android.chrome/com.google.android.apps.chrome.Main', rank: 1, position_x: -1, position_y: -1, container_type: 1, container_id: 8, hidden: 0 },
        { id: 76, type: 'app', title: 'Gmail', component: 'com.google.android.gm/.ConversationListActivityGmail', rank: 0, position_x: -1, position_y: -1, container_type: 1, container_id: 8, hidden: 0 },
        { id: 21, type: 'app', title: 'Clock', component: 'com.sec.android.app.clockpackage/.ClockPackage', position_x: 0, position_y: 5, container_type: 0, container_id: 4, hidden: 0 },
        { id: 28, type: 'app', title: 'Messages', component: 'com.google.android.apps.messaging/.ui.ConversationListActivity', position_x: 1, position_y: 0, container_type: 0, container_id: 5, hidden: 0 },
        { id: 27, type: 'app', title: 'Phone', component: 'com.samsung.android.dialer/.DialtactsActivity', position_x: 0, position_y: 0, container_type: 0, container_id: 5, hidden: 0 },
        { id: 116, type: 'app', title: 'Snapchat', component: 'com.snapchat.android/.LandingPageActivity', position_x: -1, position_y: -1, container_type: 0, container_id: 8, hidden: 0 },
    ];
    const h = D.oneUiHome(items, groups);
    assert.deepStrictEqual([h.cols, h.rows, h.pages.length], [4, 6, 2]);
    assert.deepStrictEqual(h.pages[0].map((c) => [c.item.kind, c.item.name || c.item.app, c.x, c.y, c.w, c.h]), [
        ['widget', 'com.sec.android.daemonapp', 0, 1, 2, 2], ['app', 'Signal', 0, 4, 1, 1], ['folder', 'Google', 3, 5, 1, 1]]);
    assert.deepStrictEqual(h.pages[0][2].item.items.map((x) => x.name), ['Gmail', 'Chrome']);
    assert.deepStrictEqual(h.dock.map((d) => d.name), ['Phone', 'Messages']);
    assert.strictEqual(h.names['com.snapchat.android'], 'Snapchat', 'namnen ur applådan');
    assert.strictEqual(D.roleOf(h.pages[0][1].item.id), 'Signal');
    assert.strictEqual(D.widgetName(h.pages[0][0].item, h.names, []), 'WeatherAppWidget2x1', 'widgeten utan känt appnamn');
    assert.strictEqual(D.widgetName({ app: 'com.snapchat.android', provider: 'com.snapchat.android/.Widget' }, h.names, []), 'Snapchat');
});

test('Launcher3 (Pixel): skrivbordets sidor, dockan, en mapp och rutnätet ur filnamnet', () => {
    const intent = (pkg) => '#Intent;action=android.intent.action.MAIN;launchFlags=0x10200000;component=' + pkg + '/.Main;end';
    const rows = [
        { _id: 1, title: 'Phone', intent: intent('com.google.android.dialer'), container: -101, screen: 0, cellX: 0, cellY: 0, itemType: 0 },
        { _id: 3, title: 'Chrome', intent: '#Intent;package=com.android.chrome;component=com.android.chrome/com.google.Main;end', container: -101, screen: 2, cellX: 2, cellY: 0, itemType: 0 },
        { _id: 5, title: 'Play Store', intent: intent('com.android.vending'), container: -100, screen: 0, cellX: 0, cellY: 4, spanX: 1, spanY: 1, itemType: 0 },
        { _id: 9, title: 'Trust Wallet', intent: intent('com.wallet.crypto.trustapp'), container: -100, screen: 1, cellX: 0, cellY: 0, spanX: 1, spanY: 1, itemType: 0 },
        { _id: 40, title: 'Plånböcker', intent: null, container: -100, screen: 1, cellX: 1, cellY: 0, spanX: 1, spanY: 1, itemType: 2 },
        { _id: 41, title: 'MetaMask', intent: intent('io.metamask'), container: 40, screen: 0, cellX: 0, cellY: 0, rank: 0, itemType: 0 },
        { _id: 50, title: null, appWidgetProvider: 'com.google.android.googlequicksearchbox/com.google.SearchWidget', container: -100, screen: 0, cellX: 0, cellY: 0, spanX: 4, spanY: 1, itemType: 4 },
    ];
    const h = D.launcher3Home(rows, '/data/data/com.google.android.apps.nexuslauncher/databases/launcher_4_by_5.db');
    assert.deepStrictEqual([h.cols, h.rows, h.source], [4, 5, 'launcher_4_by_5.db']);
    assert.deepStrictEqual(h.pages.map((p) => p.map((c) => (c.item.name || c.item.app) + '@' + c.x + ',' + c.y + ':' + c.w)), [
        ['com.google.android.googlequicksearchbox@0,0:4', 'Play Store@0,4:1'], ['Trust Wallet@0,0:1', 'Plånböcker@1,0:1']]);
    assert.deepStrictEqual(h.pages[1][1].item.items.map((x) => x.id), ['io.metamask']);
    assert.deepStrictEqual(h.dock.map((d) => d.id), ['com.google.android.dialer', 'com.android.chrome']);
});

test('appens namn: Info.plist, launcherns titel, App-ID:s katalog, Apples appar och sist id:t', () => {
    assert.deepStrictEqual(D.infoName({ CFBundleIdentifier: 'com.toyopagroup.picaboo', CFBundleDisplayName: 'Snapchat', CFBundleName: 'Picaboo' }), { id: 'com.toyopagroup.picaboo', name: 'Snapchat' });
    assert.strictEqual(D.infoName({ CFBundleIdentifier: 'x' }), null);
    assert.strictEqual(D.infoName({ CFBundleIdentifier: 'net.whatsapp.WhatsApp', CFBundleDisplayName: '\u200eWhatsApp' }).name, 'WhatsApp');
    assert.strictEqual(D.appName('com.apple.weather', { 'com.apple.weather': 'Weather' }), 'Väder', 'Apples appar på svenska');
    assert.strictEqual(D.roleOf('net.whatsapp.WhatsAppSMB'), '', 'WhatsApp Business har en egen databas');
    assert.strictEqual(D.appName('com.apple.Preferences'), 'Inställningar');
    assert.strictEqual(D.appName('net.whatsapp.WhatsApp', null, [{ name: 'WhatsApp', ios: { bundleId: 'net.whatsapp.WhatsApp' } }]), 'WhatsApp');
    assert.strictEqual(D.appName('xyz.mnflopapp.Mnfl-Budget-Manager'), 'Mnfl-Budget-Manager');
    assert.strictEqual(D.packageOf('com.whatsapp/.Main'), 'com.whatsapp');
    assert.strictEqual(D.packageOf('#Intent;action=x;package=com.google.android.gm;end'), 'com.google.android.gm');
});

test('iOS: om telefonen, kända Wi-Fi-nät med tider och konton per namn', () => {
    const about = D.iosAbout({ ProductName: 'iPhone OS', ProductVersion: '26.4.1', ProductBuildVersion: '23E254' }, { System: { System: { ComputerName: 'iPhone' } } },
        { PhoneNumber: 46700000000, LastKnownICCID: '8946000000000000000', LastKnownServingMcc: 240, LastKnownServingMnc: 1 });
    assert.deepStrictEqual(about.rows.map((r) => r.label + '=' + r.value), ['Namn=iPhone', 'Systemversion=iOS 26.4.1 (23E254)', 'Telefonnummer=+46700000000', 'SIM (ICCID)=8946000000000000000', 'Senaste nät (MCC/MNC)=240 / 1']);
    const ns = (ms) => ({ __nsdate: ms / 1000 - 978307200 });
    const nets = D.iosWifi({
        'wifi.network.ssid.Labbnätet': { SSID: enc('Labbnätet'), SupportedSecurityTypes: 'WPA2 Personal', AddedAt: ns(Date.UTC(2025, 4, 26)), AddReason: 'SetupAssistant',
            BSSList: [{ LastAssociatedAt: ns(Date.UTC(2026, 10, 11)) }, { LastAssociatedAt: ns(Date.UTC(2026, 10, 19, 7, 34)) }] },
        'wifi.network.ssid.5,0 GHz': { SSID: enc('5,0 GHz'), AddedAt: ns(Date.UTC(2026, 9, 30)), JoinedBySystemAt: ns(Date.UTC(2026, 10, 11, 20)), BundleID: 'com.apple.camera', AddReason: 'System App' },
    });
    assert.deepStrictEqual(nets.map((n) => [n.ssid, D.utc(n.lastMs), n.bundle]), [['Labbnätet', '2026-11-19 07:34:00 UTC', ''], ['5,0 GHz', '2026-11-11 20:00:00 UTC', 'com.apple.camera']]);
    const acc = D.accounts([{ user: 'lab@icloud.com', kind: 'iCloud', ms: 2000 }, { user: 'lab@icloud.com', kind: 'Apple ID', ms: 1000 }, { user: null, kind: 'CalDAV', ms: 3000 }, { user: 'lab@icloud.com', kind: 'iCloud', ms: 5 }]);
    assert.deepStrictEqual(acc.map((a) => [a.user, a.kinds.join(','), a.firstMs]), [['lab@icloud.com', 'iCloud,Apple ID', 5], ['', 'CalDAV', 3000]]);
});

test('Android: inställningarna i ABX och text, build.prop, lägena, Wi-Fi utan lösenordet och Bluetooth', () => {
    const global = D.settingsMap(abxSettings([['device_name', "Labbtelefonen"], ['airplane_mode_on', '1'], ['wifi_on', '3'], ['default_device_name', 'Galaxy A33 5G'], ['adb_enabled', '1']]), abxParse);
    assert.strictEqual(global.device_name, "Labbtelefonen");
    const secure = D.settingsMap(enc('<?xml version="1.0"?><settings version="1"><setting id="1" name="android_id" value="0123456789abcdef" package="android" /><setting id="2" name="location_mode" value="0" /></settings>'), abxParse);
    assert.deepStrictEqual(secure, { android_id: '0123456789abcdef', location_mode: '0' });
    const props = D.buildProps(['ro.product.system.model=mainline\nro.build.version.release=16\n# kommentar=x', 'ro.product.vendor.model=Pixel 9a\nro.product.vendor.brand=google\nro.build.version.release=15']);
    const about = D.androidAbout(props, global, secure);
    assert.deepStrictEqual(about.rows.map((r) => r.label + '=' + r.value), ["Namn=Labbtelefonen", 'Modellnamn=Galaxy A33 5G', 'Modell=Google Pixel 9a', 'Android-version=16', 'Android-id=0123456789abcdef']);
    const t = D.androidToggles(global, secure, { screen_off_timeout: '600000' });
    assert.deepStrictEqual(t.rows.map((r) => r.label + '=' + r.value), ['Flygplansläge=På', 'Wi-Fi=Av (flygplansläge, sparat på)', 'Plats=Av', 'USB-felsökning=På', 'Skärmen släcks efter=10 min']);
    const wifi = D.androidWifi(['<NetworkList><Network><WifiConfiguration><string name="ConfigKey">&quot;Labbnätet&quot;WPA_PSK</string><string name="SSID">&quot;Labbnätet&quot;</string>' +
        '<string name="PreSharedKey">&quot;hemligt&quot;</string><string name="CreatorName">android.uid.system:1000</string><boolean name="IsMostRecentlyConnected" value="true" /></WifiConfiguration>' +
        '<NetworkStatus><boolean name="HasEverConnected" value="true" /></NetworkStatus></Network></NetworkList>']);
    assert.deepStrictEqual(wifi, [{ ssid: 'Labbnätet', security: 'WPA/WPA2 Personal', hasKey: true, creator: 'android.uid.system:1000', connected: true, recent: true, createdText: '' }]);
    assert.ok(!JSON.stringify(wifi).includes('hemligt'), 'lösenordet följer inte med');
    const bt = D.androidBluetooth('[Info]\nFileSource = Empty\n\n[Adapter]\nAddress = 02:00:00:00:00:01\nName = Labbtelefonen\n\n[aa:bb:cc:dd:ee:ff]\nName = Hörlurar\nDevType = 1\nLinkKey = 00\nTimestamp = 1763000000\n');
    assert.deepStrictEqual(bt, { adapter: { name: "Labbtelefonen", address: '02:00:00:00:00:01' }, devices: [{ address: 'aa:bb:cc:dd:ee:ff', name: 'Hörlurar', paired: true, ms: 1763000000000, type: 'Klassisk' }] });
});

test('bakgrunden: komponenten ur wallpaper_info.xml och bildens format ur de första byten', () => {
    assert.deepStrictEqual(D.wallpaperInfo(enc('<?xml version="1.0"?><wp id="1" component="com.android.systemui/.wallpapers.ImageWallpaper"><description /></wp><kwp id="2" component="com.android.systemui/.wallpapers.ImageWallpaper" />')),
        { home: 'com.android.systemui/.wallpapers.ImageWallpaper', lock: 'com.android.systemui/.wallpapers.ImageWallpaper' });
    assert.strictEqual(D.imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13])), 'image/png');
    assert.strictEqual(D.imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])), 'image/jpeg');
    assert.strictEqual(D.imageType(enc('ABX\u0000...........')), null);
});

test('ikonerna: launcherns ikoncache app_icons.db per paket och huvudanvändare, och ikonen på hemskärmens rad', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 1]);
    const cache = D.iconCache([
        { componentName: 'im.molly.app/org.thoughtcrime.securesms.RoutingActivity', profileId: 0, icon: png, label: 'Molly' },
        { componentName: 'im.molly.app/org.thoughtcrime.securesms.RoutingActivity', profileId: 150, icon: png, label: 'Molly (jobb)' },
        { componentName: 'com.example/.Main', profileId: 0, icon: new Uint8Array([1, 2, 3]), label: 'Trasig' },
    ]);
    assert.deepStrictEqual(Object.keys(cache), ['im.molly.app']);
    assert.strictEqual(cache['im.molly.app'].label, 'Molly');
    const h = D.launcher3Home([{ _id: 2, title: 'Messages', intent: '#Intent;component=com.google.android.apps.messaging/.ui.Main;end', container: -101, screen: 0, itemType: 0, icon: png },
        { _id: 1, title: 'Phone', intent: '#Intent;component=com.google.android.dialer/.Main;end', container: -101, screen: 1, itemType: 0, icon: null }], 'launcher.db');
    assert.deepStrictEqual(h.dock.map((d) => !!d.icon), [true, false]);
});

test('Androids notishistorik: strängarna i posten eller i poolen, tid, titel och text', () => {
    const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
    const vint = (f, n) => [...varint(f * 8), ...varint(n)];
    const bytes = (f, b) => [...varint(f * 8 + 2), ...varint(b.length), ...b];
    const str = (f, s) => bytes(f, [...Buffer.from(s, 'utf8')]);
    const file = new Uint8Array([
        ...bytes(1, [...vint(1, 2), ...str(2, 'com.whatsapp'), ...str(2, 'Meddelanden')]),
        ...vint(2, 1),
        ...bytes(3, [...str(1, 'com.snapchat.android'), ...str(3, 'Chattar'), ...str(5, 'chat'), ...vint(7, 10330), ...vint(9, 1793974034423), ...str(10, 'Kim'), ...str(11, 'skickade en snap'), ...bytes(12, [...vint(1, 2)]), ...str(15, '0|com.snapchat.android|1|null|10330')]),
        ...bytes(3, [...vint(2, 1), ...vint(4, 2), ...vint(9, 1793974000000), ...str(10, 'Lo')]),
    ]);
    const list = D.notificationHistory(file);
    assert.deepStrictEqual(list.map((n) => [n.app, n.channel, n.ms, n.title, n.text]), [
        ['com.snapchat.android', 'Chattar', 1793974034423, 'Kim', 'skickade en snap'],
        ['com.whatsapp', 'Meddelanden', 1793974000000, 'Lo', ''],
    ]);
    assert.strictEqual(list[0].key, '0|com.snapchat.android|1|null|10330');
    assert.deepStrictEqual(D.fileOf('Dump/data/system_ce/0/notification_history/history/1793974652242'), { id: 'notifHistory', wal: false });
    assert.deepStrictEqual(D.fileOf('filesystem1/private/var/mobile/Library/Biome/streams/restricted/Notification.Usage/local/770626098768390'), { id: 'biomeNotif', wal: false });
    assert.strictEqual(D.fileOf('filesystem1/private/var/mobile/Library/Biome/streams/restricted/Notification.Usage/local/tombstone/773568286508021'), null);
});
