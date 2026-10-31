// Varje databas i Queries ska ha exakt en rekommenderad query som inte är en hjälpfråga,
// och varje query ska säga vad den gör.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const photos = require(path.join(ROOT, 'queries', 'ios', 'photos-sqlite', 'catalog.json'));
const android = require(path.join(ROOT, 'queries', 'android', 'catalog.json'));
const appUsage = require(path.join(ROOT, 'queries', 'app-usage', 'catalog.json'));
const routined = require(path.join(ROOT, 'queries', 'ios', 'routined', 'catalog.json'));
const snapchat = require(path.join(ROOT, 'queries', 'ios', 'snapchat', 'catalog.json'));
const snapchatAndroid = require(path.join(ROOT, 'queries', 'android', 'snapchat', 'catalog.json'));

// Rollqueryer (hidden) hör till Härkomst och visas inte i Queries. De kontrolleras för sig.
const visible = (list) => list.filter((q) => !q.hidden);

function checkGroup(name, queries, describe) {
    queries = visible(queries);
    const recommended = queries.filter((q) => q.recommended);
    assert.strictEqual(recommended.length, 1, name + ': ska ha exakt en rekommenderad query');
    assert.notStrictEqual(recommended[0].group, 'advanced', name + ': den rekommenderade får inte vara en hjälpfråga');
    for (const q of queries) {
        const text = String(describe(q) || '').trim();
        assert.ok(text.length >= 20, name + '/' + q.id + ': beskrivningen saknas eller är för kort');
    }
}

test('Android: en rekommenderad query per kategori och beskrivning på alla', () => {
    for (const cat of android.categories) checkGroup('android-' + cat.id, cat.queries, (q) => q.description);
});

test('App-aktivitet: en rekommenderad query per databas och undertext på alla', () => {
    for (const db of appUsage.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
});

test('routined: en rekommenderad query per databas och undertext på alla', () => {
    for (const db of routined.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
});

test('snapchat (beta): en rekommenderad query per databas, undertext på alla, tider i millisekunder', () => {
    for (const db of snapchat.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
    for (const db of snapchat.databases) for (const q of db.queries) {
        if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Snapchat-tider är millisekunder, använd unixMs-platshållarna');
        if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
    }
    const cache = snapchat.databases.find((d) => d.id === 'snapchat-cache');
    assert.match(cache.queries.find((q) => q.id === 'cached-media').sql, /CACHE_FILE_CLAIM[\s\S]*CACHE_FILE_METADATA/);
    const arroyo = snapchat.databases.find((d) => d.id === 'snapchat-arroyo');
    assert.match(arroyo.queries.find((q) => q.id === 'messages').sql, /hex\(substr\(message_content, 7, 16\)\)/, 'avsändar-id ska gå att kontrollera för hand');
});

test('snapchat på Android (beta): en rekommenderad query per databas, undertext på alla, tider i millisekunder, sökvägar under appens datamapp', () => {
    assert.deepStrictEqual(snapchatAndroid.databases.map((d) => d.id), ['snapchat-android-cache', 'snapchat-android-arroyo', 'snapchat-android-friends', 'snapchat-android-notifications', 'snapchat-android-memories', 'snapchat-android-journal']);
    for (const db of snapchatAndroid.databases) {
        checkGroup(db.id, db.queries, (q) => q.subtitle);
        assert.ok(db.paths.every((p) => p.startsWith('data/data/com.snapchat.android/databases/')), db.id + ': sökvägarna');
        for (const q of db.queries) {
            if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Snapchat-tider är millisekunder, använd unixMs-platshållarna');
            if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
            if (q.hidden) { assert.strictEqual(q.epoch, 'unixMs', db.id + '/' + q.id + ': epoch'); assert.ok(q.fields, db.id + '/' + q.id + ': fields'); }
        }
    }
    const roles = (id) => snapchatAndroid.databases.find((d) => d.id === id).queries.filter((q) => q.hidden).map((q) => q.role).sort();
    assert.deepStrictEqual(roles('snapchat-android-cache'), ['cache-key', 'cache-window', 'coverage']);
    assert.deepStrictEqual(roles('snapchat-android-arroyo'), ['coverage', 'messages']);
    assert.deepStrictEqual(roles('snapchat-android-memories'), ['coverage', 'memories']);
    // Samma fältkarta som iOS för cache och meddelanden, så att snapchat.js kan läsa båda.
    const iosCache = snapchat.databases.find((d) => d.id === 'snapchat-cache').queries.find((q) => q.role === 'cache-window');
    const andCache = snapchatAndroid.databases.find((d) => d.id === 'snapchat-android-cache').queries.find((q) => q.role === 'cache-window');
    assert.deepStrictEqual(andCache.fields, iosCache.fields);
    const msg = snapchatAndroid.databases.find((d) => d.id === 'snapchat-android-arroyo').queries.find((q) => q.role === 'messages');
    assert.strictEqual(msg.fields.senderId, 'sender_id');
    assert.strictEqual(msg.fields.createdOnDevice, 'created_on_device');
    const mem = snapchatAndroid.databases.find((d) => d.id === 'snapchat-android-memories').queries.find((q) => q.role === 'memories');
    assert.strictEqual(mem.fields.captured, 'snap_capture_time');
    assert.strictEqual(mem.fields.front, 'front_facing');
});

test('routined: positionerna tar bara med kända ZTYPE (1 GNSS, 4 Wi-Fi) och filtrerar på råtiden', () => {
    const q = routined.databases[0].queries.find((x) => x.id === 'locations');
    assert.match(q.sql, /ZTYPE IN \(1, 4\)/);
    assert.match(q.sql, /ZTIMESTAMP BETWEEN \{\{cocoaStart\}\} AND \{\{cocoaEnd\}\}/);
    assert.doesNotMatch(q.sql, /WHERE[\s\S]*localtime/);
});

test('Photos.sqlite: en rekommenderad query i varje band och undertext på alla', () => {
    for (const band of photos.bands) {
        const ids = new Set(band.queries.map((q) => q.id));
        checkGroup('photos-' + band.id, photos.questions.filter((q) => ids.has(q.id)), (q) => q.subtitle);
    }
});

test('hjälpfrågor heter "Hjälp: …" eller "Tips: …"', () => {
    const all = [
        ...photos.questions.map((q) => [q.id, q.label, q.group]),
        ...android.categories.flatMap((c) => c.queries.map((q) => [q.id, q.title, q.group])),
        ...appUsage.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
        ...routined.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
        ...snapchat.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
    ];
    for (const [id, title, group] of all) {
        if (/^(Hjälp|Tips):/.test(title)) assert.strictEqual(group, 'advanced', id + ': hjälpfråga utan group advanced');
    }
});

// Härkomst hämtar sin SQL ur katalogerna via fältet role. Varje rollquery är dold i Queries,
// anger epoch för tiderna och har en fältkarta vars kolumner finns i SQL:en.
test('rollqueryer för Härkomst: dolda, med epoch och fältkarta som stämmer med SQL:en', () => {
    const groups = [];
    for (const band of photos.bands) {
        for (const q of band.queries) {
            const question = photos.questions.find((x) => x.id === q.id);
            if (!question || !question.hidden) continue;
            groups.push(['photos-' + band.id + '/' + q.id, Object.assign({}, question, q)]);
        }
    }
    for (const db of appUsage.databases) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const db of routined.databases) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const db of snapchat.databases) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const cat of android.categories) for (const q of cat.queries) if (q.hidden) groups.push(['android-' + cat.id + '/' + q.id, q]);
    assert.ok(groups.length >= 12, 'för få rollqueryer: ' + groups.length);
    for (const [name, q] of groups) {
        assert.ok(q.role, name + ': role saknas');
        assert.ok(['cocoa', 'unixS', 'unixMs'].includes(q.epoch), name + ': epoch saknas eller okänd');
        assert.ok(q.fields && typeof q.fields === 'object' && Object.keys(q.fields).length, name + ': fields saknas');
        for (const [key, spec] of Object.entries(q.fields)) {
            const col = typeof spec === 'string' ? spec : spec.col;
            assert.ok(col, name + ': fältet ' + key + ' saknar kolumn');
            assert.ok(new RegExp('\\b' + col + '\\b').test(q.sql), name + ': kolumnen ' + col + ' (' + key + ') finns inte i SQL:en');
            if (typeof spec !== 'string') assert.ok(['cocoa', 'unixS', 'unixMs', 'unixAuto'].includes(spec.epoch), name + ': ' + key + ' har okänd epoch');
        }
        assert.doesNotMatch(q.sql, /localtime/, name + ': rollqueryer returnerar råa tider, inte localtime');
    }
    const roles = (list) => list.filter((q) => q.hidden).map((q) => q.role).sort();
    for (const band of photos.bands) {
        const ids = new Set(band.queries.map((q) => q.id));
        assert.deepStrictEqual(photos.questions.filter((q) => q.hidden && ids.has(q.id)).map((q) => q.role).sort(), ['file', 'neighbours', 'sequence'], 'photos-' + band.id);
    }
    assert.deepStrictEqual(roles(appUsage.databases.find((d) => d.id === 'knowledgec').queries), ['app-infocus', 'app-usage', 'coverage', 'lock', 'screen']);
    assert.deepStrictEqual(roles(appUsage.databases.find((d) => d.id === 'wellbeing').queries), ['app-events', 'coverage']);
    assert.deepStrictEqual(roles(routined.databases[0].queries), ['coverage', 'location']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-cache').queries), ['cache-key', 'cache-window', 'coverage']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-arroyo').queries), ['coverage', 'messages']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-friends').queries), ['friends']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-notifications').queries), ['coverage', 'notifications']);
    assert.deepStrictEqual(roles(android.categories.find((c) => c.id === 'mediastore').queries), ['file', 'neighbours']);
});

// Extraktion: databaserna hittas i en zip på sökvägarna i "paths". De skrivs utan inledande /
// och utan prefix, så att de kan jämföras bakifrån mot namnen i zippen.
test('sökvägar för extraktion: alla SQL-databaser har dem, och de är skrivna utan prefix', () => {
    const groups = [
        ['photos', photos.paths],
        ...appUsage.databases.map((d) => [d.id, d.paths]),
        ...routined.databases.map((d) => [d.id, d.paths]),
        ...snapchat.databases.map((d) => [d.id, d.paths]),
        ...android.categories.filter((c) => c.id !== 'usage').map((c) => ['android-' + c.id, c.paths]),
    ];
    for (const [name, paths] of groups) {
        assert.ok(Array.isArray(paths) && paths.length, name + ': paths saknas');
        for (const p of paths) {
            assert.ok(!/^\//.test(p) && !/\s|\(|…/.test(p), name + ': ' + p + ' ska vara en ren sökväg utan inledande /');
        }
    }
    const bands = photos.bands.map((b) => b.ios);
    assert.ok(bands.every((r) => Array.isArray(r) && r.length === 2), 'Photos: varje band behöver ios: [från, till]');
    for (let v = 10; v <= 26; v++) {
        assert.strictEqual(bands.filter((r) => v >= r[0] && v <= r[1]).length, 1, 'Photos: iOS ' + v + ' ska höra till exakt ett band');
    }
});
