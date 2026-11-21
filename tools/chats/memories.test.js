// Snapchat Memories på iPhone: snapsen, nyckeln per snap, positionen och filerna i cachen, och dekrypteringen.
const test = require('node:test');
const assert = require('node:assert');
const M = require('./memories');

const KEY = new Uint8Array(32).fill(7), IV = new Uint8Array(16).fill(3);

test('filerna känns igen, med -wal', () => {
    const p = M.pick([
        { name: 'private/var/mobile/Containers/Data/Application/X/Documents/gallery_data_object/1/abc/scdb-27.sqlite3' },
        { name: 'private/var/mobile/Containers/Data/Application/X/Documents/gallery_data_object/1/abc/scdb-27.sqlite3-wal' },
        { name: 'private/var/mobile/Containers/Data/Application/X/Documents/gallery_encrypted_db/3/abc/gallery.encrypteddb' },
        { name: 'private/var/mobile/Containers/Data/Application/X/Documents/global_scoped/cachecontroller/cache_controller.db' },
        { name: 'annat/scdb-27.sqlite3' },
    ]);
    assert.deepStrictEqual(Object.keys(p).sort(), ['cache', 'gallery', 'scdb']);
    assert.ok(p.scdb.wal && !p.gallery.wal);
    assert.ok(M.FILE_MANAGER.test('/Documents/com.snap.file_manager_3_SCContent_3c75669d/abc123'));
});

test('en snap med nyckel, position och filer i cachen; en i My Eyes Only med låst nyckel', () => {
    const list = M.build(
        [{ id: 'A', capture: 785000000, created: 785000010, format: 1, meo: 0, overlay: 1 }, { id: 'B', capture: 785100000, created: 785100000, format: 0, duration: 4.2, meo: 1 }],
        [{ id: 'A', key: KEY, iv: IV, encrypted: 0 }, { id: 'B', key: new Uint8Array(48), iv: new Uint8Array(32), encrypted: 1 }],
        [{ id: 'A', lat: 59.33, lon: 18.06, address: 'Kungsholmen' }],
        [{ cacheKey: 'k1', ctx: 19, ext: 'snap-media-A' }, { cacheKey: 'k2', ctx: 19, ext: 'snap-overlay-A' }, { cacheKey: 'k3', ctx: 19, ext: 'B~1' }, { cacheKey: 'k4', ctx: 26, ext: 'snap-rendered-lowres-A' }],
    );
    assert.deepStrictEqual(list.map((m) => m.id), ['B', 'A'], 'nyast först');
    const a = list[1], b = list[0];
    assert.strictEqual(a.captureMs, (785000000 + 978307200) * 1000);
    assert.strictEqual(a.media, 'k1');
    assert.strictEqual(a.overlay, 'k2');
    assert.strictEqual(a.address, 'Kungsholmen');
    assert.ok(a.key && !a.keyLocked && a.kind === 'bild');
    assert.ok(b.meo && b.keyLocked && b.key === null && b.media === 'k3' && b.kind === 'video' && b.durationS === 4.2);
    assert.deepStrictEqual(M.counts(list), { all: 2, meo: 1, locked: 1, unlocked: 0, located: 1, files: 2 });
});

test('My Eyes Only: nyckeln och iv:n öppnas med nyckeltjänstens masterKey och IV (AES-256-CBC)', async () => {
    const mk = new Uint8Array(32).fill(5), miv = new Uint8Array(16).fill(6);
    const k = await crypto.subtle.importKey('raw', mk, { name: 'AES-CBC' }, false, ['encrypt']);
    const wrap = async (b) => new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: miv }, k, b));
    const list = M.build([{ id: 'B', capture: 785100000, format: 1, meo: 1 }], [{ id: 'B', key: await wrap(KEY), iv: await wrap(IV), encrypted: 1 }], [], []);
    assert.strictEqual(list[0].keyLocked, true);
    assert.strictEqual(await M.unlock(crypto.subtle, list, { key: new Uint8Array(32), iv: miv }), 0, 'fel nyckel öppnar inget');
    assert.strictEqual(list[0].keyLocked, true);
    assert.strictEqual(await M.unlock(crypto.subtle, list, { key: mk, iv: miv }), 1);
    assert.deepStrictEqual(Array.from(list[0].key), Array.from(KEY));
    assert.deepStrictEqual(Array.from(list[0].iv), Array.from(IV));
    assert.ok(list[0].unlocked && !list[0].keyLocked);
    assert.strictEqual(M.counts(list).unlocked, 1);
});

test('dekrypteringen med AES-256-CBC ger filen, och typen känns igen', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const k = await crypto.subtle.importKey('raw', KEY, { name: 'AES-CBC' }, false, ['encrypt']);
    const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: IV }, k, jpeg));
    const out = await M.decrypt(crypto.subtle, enc, KEY, IV);
    assert.deepStrictEqual(Array.from(out), Array.from(jpeg));
    assert.strictEqual(M.mime(out), 'image/jpeg');
    await assert.rejects(M.decrypt(crypto.subtle, enc, new Uint8Array(32), IV));
});
