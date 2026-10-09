const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('./catalog.js');

test('signal resolves to the lookup bundle id and store ids', function () {
    const hits = catalog.filterApps('signal');
    const signal = hits.find(function (entry) { return entry.id === 'signal'; });
    assert.ok(signal);
    assert.equal(signal.ios.bundleId, 'org.whispersystems.signal');
    assert.equal(signal.ios.trackId, 874139669);
    assert.equal(signal.android, 'org.thoughtcrime.securesms');
    assert.equal(signal.appStoreUrl, 'https://apps.apple.com/se/app/id874139669');
    assert.equal(signal.playUrl, 'https://play.google.com/store/apps/details?id=org.thoughtcrime.securesms');
});

test('search matches android package and ios bundle', function () {
    assert.equal(catalog.filterApps('com.whatsapp.w4b')[0].id, 'whatsapp-business');
    assert.equal(catalog.filterApps('ph.telegra.telegraph')[0].id, 'telegram');
});

test('twitter alias finds X', function () {
    assert.equal(catalog.filterApps('twitter')[0].id, 'x');
});

test('built-in ios apps have no store link', function () {
    const sms = catalog.APPS.find(function (entry) { return entry.id === 'imessage'; });
    assert.equal(sms.ios.bundleId, 'com.apple.MobileSMS');
    assert.equal(sms.appStoreUrl, '');
    assert.equal(sms.playUrl, '');
});

test('swedish bank and encrypted chat come from lookup', function () {
    assert.equal(catalog.filterApps('avanza')[0].ios.bundleId, 'se.avanza.iphone');
    assert.equal(catalog.filterApps('avanza')[0].ios.trackId, 381311572);
    assert.equal(catalog.filterApps('delta chat')[0].ios.bundleId, 'chat.delta');
    assert.equal(catalog.filterApps('exodus')[0].ios.bundleId, 'exodus-movement.exodus');
});

test('catalog covers chat and crypto and is larger than a short sample', function () {
    assert.ok(catalog.APPS.length >= 90);
    assert.ok(catalog.APPS.filter(function (entry) { return entry.category === 'chatt'; }).length >= 20);
    assert.ok(catalog.APPS.filter(function (entry) { return entry.category === 'krypto'; }).length >= 20);
});

test('unknown query returns none', function () {
    assert.equal(catalog.filterApps('xyzzy-not-an-app').length, 0);
});

test('category filter keeps the search', function () {
    const crypto = catalog.filterApps('signal', 'krypto');
    assert.equal(crypto.length, 0);
    const chat = catalog.filterApps('', 'chatt');
    assert.ok(chat.every(function (entry) { return entry.category === 'chatt'; }));
    assert.ok(chat.some(function (entry) { return entry.id === 'signal'; }));
});

test('csv keeps ios and android ids in separate columns', function () {
    const rows = catalog.filterApps('signal').filter(function (entry) { return entry.id === 'signal'; });
    const csv = catalog.toCsv(rows);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0], 'namn,typ,ios_bundle_id,android_bundle_id');
    assert.equal(lines[1], 'Signal,Chatt,org.whispersystems.signal,org.thoughtcrime.securesms');
    const sms = catalog.APPS.find(function (entry) { return entry.id === 'imessage'; });
    const smsLine = catalog.toCsv([sms]).trim().split('\r\n')[1];
    assert.equal(smsLine, 'Meddelanden,Förinstallerat iOS,com.apple.MobileSMS,');
    const fluffy = catalog.APPS.find(function (entry) { return entry.id === 'fluffychat'; });
    const silence = catalog.APPS.find(function (entry) { return entry.id === 'silence'; });
    const extra = catalog.toCsv([fluffy, silence]).trim().split('\r\n');
    assert.equal(extra[1], 'FluffyChat,Chatt,im.fluffychat.app,chat.fluffy.fluffychat');
    assert.equal(extra[2], 'Silence,Chatt,,org.smssecure.smssecure');
});

test('known false app store hits stay out of the catalog', function () {
    const banned = [
        'com.appsmoment.thainews',
        'com.curriculify.app',
        'br.com.tapps.jackpott',
        'de.xcom.htx',
        'app.reverso.com',
        'app.compassweb3.sei',
        'com.radiosilence.scribblr',
        'hu.f400.CoverMe',
        'com.vonventuresllc.confide',
        'com.microsoft.lync2013.iphone',
    ];
    catalog.APPS.forEach(function (entry) {
        const bundle = entry.ios && entry.ios.bundleId;
        assert.equal(banned.indexOf(bundle), -1, entry.id);
        assert.equal(banned.indexOf(entry.android), -1, entry.id);
    });
    const csn = catalog.APPS.find(function (entry) { return entry.id === 'csn'; });
    assert.equal(csn.ios.bundleId, 'se.csn.Mina-sidor');
    assert.equal(csn.android, null);
});
