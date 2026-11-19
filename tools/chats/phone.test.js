'use strict';
// Telefonen i Chattar: apparna på hemskärmen, bildernas nycklar i zippen, galleriets rader och cachen för bilderna.
const test = require('node:test');
const assert = require('node:assert');
const P = require('./phone.js');

test('hemskärmen: en app per app med databas, antalet chattar i de lästa, och läget medan de läses', () => {
    const db = (app, st, n) => ({ src: { app }, state: st, threads: Array.from({ length: n }, (_, i) => ({ key: app + i, lastMs: i * 1000 })) });
    const apps = P.homeApps([db('WhatsApp', 'ready', 3), db('Signal', 'busy', 0), db('WhatsApp', 'ready', 2), db('Telegram', 'error', 0)]);
    assert.deepStrictEqual(apps.map((a) => [a.app, a.count, a.busy, a.error, a.dbs.join()]), [['WhatsApp', 5, false, false, '0,2'], ['Signal', 0, true, false, '1'], ['Telegram', 0, false, true, '3']]);
    const list = P.appThreads([db('WhatsApp', 'ready', 3), db('Signal', 'busy', 0), db('WhatsApp', 'ready', 2)], [0, 2]);
    assert.deepStrictEqual(list.map((x) => x.thread.key + '@' + x.db), ['WhatsApp2@0', 'WhatsApp1@0', 'WhatsApp1@2', 'WhatsApp0@0', 'WhatsApp0@2']);
});

test('bildernas nycklar: tumnageln och originalet på iOS, filen i DCIM och Pictures på Android', () => {
    assert.deepStrictEqual(P.entryKey('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0012.HEIC/5005.JPG'), { kind: 'thumb', key: 'dcim/100apple/img_0012.heic' });
    assert.deepStrictEqual(P.entryKey('/private/var/mobile/Media/DCIM/100APPLE/IMG_0012.HEIC'), { kind: 'file', key: 'dcim/100apple/img_0012.heic' });
    assert.deepStrictEqual(P.entryKey('filesystem1/private/var/mobile/Media/PhotoData/CPLAssets/group388/AA82.JPG'), { kind: 'file', key: 'photodata/cplassets/group388/aa82.jpg' });
    assert.deepStrictEqual(P.entryKey('data/media/0/DCIM/Camera/PXL_1.jpg'), { kind: 'file', key: 'dcim/camera/pxl_1.jpg' });
    assert.deepStrictEqual(P.entryKey('data/media/0/Pictures/Screenshots/S.png'), { kind: 'file', key: 'pictures/screenshots/s.png' });
    assert.strictEqual(P.entryKey('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_1.JPG/5003.JPG'), null);
    assert.strictEqual(P.entryKey('private/var/mobile/Media/PhotoData/Photos.sqlite'), null);
    assert.strictEqual(P.entryKey('data/media/0/DCIM/notes.txt'), null);
});

test('bilderna ur bildbibliotekets rad: nyckeln som i zippen, den senaste först, video, papperskorgen och tid som saknas', () => {
    const items = P.photoItems([
        { directory: 'DCIM/100APPLE', filename: 'IMG_0001.JPG', createdMs: 1000, trashed: 0 },
        { directory: 'DCIM/100APPLE', filename: 'IMG_0002.MOV', createdMs: 3000, trashed: 1 },
        { relativePath: 'DCIM/Camera/', filename: 'PXL.heic', createdMs: null, addedMs: 2000 },
        { directory: 'DCIM/100APPLE', filename: 'IMG_0003.PNG', createdMs: null },
    ]);
    assert.deepStrictEqual(items.map((i) => [i.key, i.ms, i.timeField, i.video, i.drawable, i.trashed]), [
        ['dcim/100apple/img_0002.mov', 3000, 'created', true, false, true],
        ['dcim/camera/pxl.heic', 2000, 'added', false, false, false],
        ['dcim/100apple/img_0001.jpg', 1000, 'created', false, true, false],
        ['dcim/100apple/img_0003.png', null, '', false, true, false],
    ]);
});

test('galleriets rader: en rubrik per månad, fyra bilder per rad, och raderna som syns', () => {
    const items = [0, 1, 2, 3, 4, 5].map((i) => ({ ms: i < 5 ? 1 : null }));
    const lay = P.layout(items, 406, { cols: 4, gap: 2, headH: 30, monthOf: (ms) => (ms === null ? 'Utan tid' : 'nov') });
    assert.strictEqual(lay.tile, 100);
    assert.deepStrictEqual(lay.rows.map((r) => r.month || r.items.join()), ['nov', '0,1,2,3', '4', 'Utan tid', '5']);
    assert.deepStrictEqual(lay.rows.map((r) => r.y), [0, 30, 132, 234, 264]);
    assert.strictEqual(lay.height, 366);
    assert.deepStrictEqual(P.rowsBetween(lay.rows, 0, 31), [0, 2]);
    assert.deepStrictEqual(P.rowsBetween(lay.rows, 140, 240), [2, 4]);
    assert.deepStrictEqual(P.rowsBetween(lay.rows, 1000, 1100), [5, 5]);
});

test('cachen för bilderna: högst max, den äldsta bort först, men aldrig en som syns', () => {
    const gone = [];
    const c = new P.UrlCache(2, (u) => gone.push(u));
    c.set('a', 'A'); c.set('b', 'B');
    c.get('a');
    c.set('c', 'C');
    assert.deepStrictEqual([...c.map.keys()], ['a', 'c']);
    assert.deepStrictEqual(gone, ['B']);
    c.set('d', 'D', (k) => k === 'a');
    assert.deepStrictEqual([...c.map.keys()], ['a', 'd']);
    assert.deepStrictEqual(gone, ['B', 'C']);
    c.clear();
    assert.deepStrictEqual(gone.sort(), ['A', 'B', 'C', 'D']);
});
