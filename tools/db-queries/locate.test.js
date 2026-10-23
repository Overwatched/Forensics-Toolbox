// Databaserna hittas bakifrån oavsett prefix, -wal kopplas till rätt databas och rätt
// SystemVersion.plist väljs bland kopiorna.

const test = require('node:test');
const assert = require('node:assert');
const loc = require('./locate');

const TARGETS = [
    { key: 'photos', paths: ['private/var/mobile/Media/PhotoData/Photos.sqlite', 'private/var/mobile/Library/Photos/Libraries/Syndication.photoslibrary/database/Photos.sqlite'] },
    { key: 'routined-cache', paths: ['private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite'] },
    { key: 'android-mediastore', paths: ['data/data/com.google.android.providers.media.module/databases/external.db'] },
];

const e = (name, size) => ({ name, size: size || 1 });

test('normalize: inledande / och /data/user/N', () => {
    assert.deepStrictEqual(loc.normalize('/data/data/a.b/databases/x.db'), { path: 'data/data/a.b/databases/x.db', user: 0 });
    assert.deepStrictEqual(loc.normalize('/data/user/10/a.b/databases/x.db'), { path: 'data/data/a.b/databases/x.db', user: 10 });
    assert.deepStrictEqual(loc.normalize('dump/data/user_de/0/a.b/x.db'), { path: 'dump/data/data/a.b/x.db', user: 0 });
    assert.deepStrictEqual(loc.normalize('filesystem1/private/var/x.db'), { path: 'filesystem1/private/var/x.db', user: null });
});

test('keeper släpper bara igenom möjliga databaser och deras följefiler', () => {
    const keep = loc.keeper(TARGETS);
    assert.ok(keep('filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-wal'));
    assert.ok(keep('x/Cache.sqlite'));
    assert.ok(keep('filesystem1/System/Library/CoreServices/SystemVersion.plist'));
    assert.ok(!keep('filesystem1/private/var/mobile/Media/PhotoData/'));
    assert.ok(!keep('filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite.bak'));
    assert.ok(!keep('x/SafetyCache.sqlite'));
});

test('hittar databaser med olika prefix och kopplar -wal, -shm och -journal', () => {
    const entries = [
        e('filesystem1/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite-wal'),
        e('filesystem1/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite'),
        e('filesystem1/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite-shm'),
        e('filesystem1/private/var/mobile/Library/Photos/Libraries/Syndication.photoslibrary/database/Photos.sqlite'),
        e('filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite'),
        e('filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-journal', 512),
        e('/data/data/com.google.android.providers.media.module/databases/external.db'),
        e('/data/user/10/com.google.android.providers.media.module/databases/external.db'),
        e('filesystem1/private/var/mobile/Library/Caches/com.apple.routined/SafetyCache.sqlite'),
        e('filesystem1/private/var/mobile/Media/PhotoData/Caches/Cache.sqlite'),
    ];
    const r = loc.locate(entries, TARGETS).found;
    assert.deepStrictEqual(r.map((f) => [f.key, f.primary, f.user]), [
        ['photos', true, null],
        ['photos', false, null],
        ['routined-cache', true, null],
        ['android-mediastore', true, 0],
        ['android-mediastore', true, 10],
    ]);
    const cache = r[2];
    assert.strictEqual(cache.wal.name, entries[0].name);
    assert.strictEqual(cache.shm.name, entries[2].name);
    assert.strictEqual(cache.journal, null);
    assert.strictEqual(r[0].wal, null);
    assert.strictEqual(r[0].journal.size, 512);
});

test('SystemVersion.plist: den under samma prefix som databaserna väljs, inte kopior i uppdateringar', () => {
    const entries = [
        e('filesystem1/private/var/MobileAsset/AssetsV2/x.asset/.AssetData/System/Library/CoreServices/SystemVersion.plist'),
        e('filesystem1/System/Library/CoreServices/SystemVersion.plist'),
        e('filesystem1/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite'),
    ];
    assert.strictEqual(loc.locate(entries, TARGETS).systemVersion.name, entries[1].name);
    assert.strictEqual(loc.locate([entries[0]], TARGETS).systemVersion.name, entries[0].name);
    assert.strictEqual(loc.locate([entries[2]], TARGETS).systemVersion, null);
});

test('iosVersion läser ProductVersion ur en XML-plist', () => {
    const xml = '<plist><dict><key>ProductName</key><string>iPhone OS</string>\n\t<key>ProductVersion</key>\n\t<string>18.7.7</string></dict></plist>';
    assert.strictEqual(loc.iosVersion(Buffer.from(xml)), '18.7.7');
    assert.strictEqual(loc.iosVersion(Buffer.from('bplist00...')), null);
});
