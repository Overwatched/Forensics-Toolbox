// Rollerna samlas ur katalogerna, rätt Photos-band väljs efter iOS-versionen, och
// platshållarna fylls i med tal i rätt epok.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const roles = require('./roles');

const ROOT = path.join(__dirname, '..', '..');
const catalogs = {
    photos: require(path.join(ROOT, 'queries', 'ios', 'photos-sqlite', 'catalog.json')),
    android: require(path.join(ROOT, 'queries', 'android', 'catalog.json')),
    appUsage: require(path.join(ROOT, 'queries', 'app-usage', 'catalog.json')),
    routined: require(path.join(ROOT, 'queries', 'ios', 'routined', 'catalog.json')),
    snapchat: require(path.join(ROOT, 'queries', 'ios', 'snapchat', 'catalog.json')),
};

test('alla källor och roller finns', () => {
    const sources = roles.collect(catalogs);
    const byKey = Object.fromEntries(sources.map((s) => [s.key, s]));
    assert.deepStrictEqual(Object.keys(byKey).sort(), ['android-mediastore', 'knowledgec', 'photos', 'routined-cache', 'snapchat-arroyo', 'snapchat-cache', 'snapchat-friends', 'snapchat-notifications', 'wellbeing']);
    assert.strictEqual(byKey['snapchat-cache'].beta, true);
    assert.deepStrictEqual(Object.keys(byKey['snapchat-cache'].roles).sort(), ['cache-key', 'cache-window', 'coverage']);
    assert.strictEqual(byKey.photos.bands.length, 4);
    for (const band of byKey.photos.bands) {
        assert.deepStrictEqual(Object.keys(band.roles).sort(), ['file', 'neighbours', 'sequence'], band.id);
        assert.ok(band.roles.file.fields.created === 'ZDATECREATED');
        assert.strictEqual(band.roles.file.epoch, 'cocoa');
    }
    assert.deepStrictEqual(Object.keys(byKey.knowledgec.roles).sort(), ['app-infocus', 'app-usage', 'coverage', 'lock', 'screen']);
    assert.deepStrictEqual(Object.keys(byKey.wellbeing.roles).sort(), ['app-events', 'coverage']);
    assert.strictEqual(byKey.wellbeing.platform, 'Android');
    assert.strictEqual(byKey.knowledgec.platform, 'iOS');
    assert.ok(byKey['android-mediastore'].paths.length >= 3);
    const dbs = roles.databases(sources);
    assert.ok(dbs.some((d) => d.id === 'photos-ios17-plus' && d.family === 'photos' && d.ios[0] === 17));
    assert.ok(dbs.every((d) => d.paths.length));
});

test('Photos-bandet väljs efter iOS-versionen och skaparkolumnen följer med', () => {
    const photos = roles.collect(catalogs).find((s) => s.key === 'photos');
    assert.strictEqual(roles.rolesFor(photos, { version: '18.7.7' }).file.fields.importer, 'ZIMPORTEDBYBUNDLEIDENTIFIER');
    assert.strictEqual(roles.rolesFor(photos, { version: '14.2' }).file.fields.importer, 'ZCREATORBUNDLEID');
    assert.strictEqual(roles.rolesFor(photos, { version: '12.0' }).file.fields.kindSubtype, undefined);
    assert.match(roles.rolesFor(photos, { version: '12.0' }).file.sql, /FROM ZGENERICASSET a/);
    assert.strictEqual(roles.rolesFor(photos, { dbId: 'photos-ios14' }).file.fields.importer, 'ZCREATORBUNDLEID');
    assert.strictEqual(roles.rolesFor(photos, {}).file.fields.importer, 'ZIMPORTEDBYBUNDLEIDENTIFIER');
});

test('platshållarna fylls i med tal i rätt epok och citerade strängar', () => {
    const window = { startMs: Date.UTC(2025, 8, 24, 12, 0, 0), endMs: Date.UTC(2025, 8, 24, 12, 30, 0) };
    const unix = Math.floor(window.startMs / 1000);
    const sql = roles.fill('a BETWEEN {{cocoaStart}} AND {{cocoaEnd}} b {{unixStart}} c {{unixMsEnd}} d \'{{filename}}\'', { window, filename: "IMG_0001'.HEIC" });
    assert.strictEqual(sql, 'a BETWEEN ' + (unix - 978307200) + ' AND ' + (unix + 1800 - 978307200) + ' b ' + unix + ' c ' + (window.endMs) + " d 'IMG_0001''.HEIC'");
    assert.throws(() => roles.fill('x {{filename}}', {}), /Platshållaren/);
});

test('råa tider blir UTC-millisekunder', () => {
    assert.strictEqual(roles.toMs(780409869.622, 'cocoa'), Math.round((780409869.622 + 978307200) * 1000));
    assert.strictEqual(roles.toMs(1727436336, 'unixS'), 1727436336000);
    assert.strictEqual(roles.toMs(1727436336123, 'unixMs'), 1727436336123);
    assert.strictEqual(roles.toMs(1727436336123, 'unixAuto'), 1727436336123);
    assert.strictEqual(roles.toMs(1727436336, 'unixAuto'), 1727436336000);
    assert.strictEqual(roles.toMs(null, 'cocoa'), null);
    assert.strictEqual(roles.toMs(0, 'unixS'), null);
});

test('mapRows ger fältkartans namn och Ms-fält för tider', () => {
    const q = { epoch: 'unixS', fields: { filename: '_display_name', created: { col: 'datetaken', epoch: 'unixAuto' }, added: 'date_added' } };
    const rows = roles.mapRows(q, { columns: ['_display_name', 'datetaken', 'date_added'], values: [['a.jpg', 1727436336123, 1727436400]] }, ['created', 'added']);
    assert.strictEqual(rows[0].filename, 'a.jpg');
    assert.strictEqual(rows[0].createdMs, 1727436336123);
    assert.strictEqual(rows[0].addedMs, 1727436400000);
    assert.strictEqual(rows[0]._raw.datetaken, 1727436336123);
});
