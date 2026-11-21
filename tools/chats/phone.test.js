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
    assert.deepStrictEqual(P.entryKey('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0012.HEIC/5005.JPG'), { kind: 'thumb', key: 'dcim/100apple/img_0012.heic', size: 5005 });
    assert.deepStrictEqual(P.entryKey('/private/var/mobile/Media/DCIM/100APPLE/IMG_0012.HEIC'), { kind: 'file', key: 'dcim/100apple/img_0012.heic' });
    assert.deepStrictEqual(P.entryKey('filesystem1/private/var/mobile/Media/PhotoData/CPLAssets/group388/AA82.JPG'), { kind: 'file', key: 'photodata/cplassets/group388/aa82.jpg' });
    assert.deepStrictEqual(P.entryKey('data/media/0/DCIM/Camera/PXL_1.jpg'), { kind: 'file', key: 'dcim/camera/pxl_1.jpg' });
    assert.deepStrictEqual(P.entryKey('data/media/0/Pictures/Screenshots/S.png'), { kind: 'file', key: 'pictures/screenshots/s.png' });
    // Andra storlekar än 5005 räknas också (en video har ibland bara en annan); 5005 väljs först när båda finns.
    assert.deepStrictEqual(P.entryKey('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_1.JPG/5003.JPG'), { kind: 'thumb', key: 'dcim/100apple/img_1.jpg', size: 5003 });
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

test('Androids lagring: allt under data/media/0 med samma nyckel som relative_path i MediaStore', () => {
    assert.deepStrictEqual(P.entryKey('Dump/data/media/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-1.jpg'), { kind: 'file', key: 'android/media/com.whatsapp/whatsapp/media/whatsapp images/img-1.jpg' });
    assert.deepStrictEqual(P.entryKey('Dump/data/media/0/DCIM/Snapchat/Snapchat-1.jpg'), { kind: 'file', key: 'dcim/snapchat/snapchat-1.jpg' });
    assert.deepStrictEqual(P.entryKey('/storage/emulated/0/Pictures/Screenshots/S.png'), { kind: 'file', key: 'pictures/screenshots/s.png' });
});

test('album och urval som i telefonens Bilder: egna album, mediatyper, appen som sparade, dolda och raderade', () => {
    const rows = [
        { pk: 1, directory: 'DCIM/100APPLE', filename: 'IMG_0001.HEIC', createdMs: 5000, kind: 0, favorite: 1, albums: [20] },
        { pk: 2, directory: 'DCIM/100APPLE', filename: 'IMG_0002.MOV', createdMs: 4000, kind: 1, albums: [20] },
        { pk: 3, directory: 'DCIM/100APPLE', filename: 'IMG_0003.PNG', createdMs: 3000, kindSubtype: 10, importer: 'com.apple.springboard' },
        { pk: 4, directory: 'DCIM/100APPLE', filename: 'IMG_0004.JPG', createdMs: 2000, importer: 'com.toyopagroup.picaboo', albums: [21] },
        { pk: 5, directory: 'DCIM/100APPLE', filename: 'IMG_0005.JPG', createdMs: 1000, hidden: 1 },
        { pk: 6, directory: 'DCIM/100APPLE', filename: 'IMG_0006.JPG', createdMs: 500, trashed: 1, importer: 'com.toyopagroup.picaboo', albums: [21] },
    ];
    const albums = P.albumList([{ pk: 20, title: 'Resan' }, { pk: 21, title: 'Snapchat', importer: 'com.toyopagroup.picaboo' }, { pk: 22, title: 'Tomt' }, { pk: 1, title: '-RootFolder-' }], rows);
    assert.deepStrictEqual(albums.map((a) => a.title + ':' + a.count), ['Resan:2', 'Snapchat:2']);
    const items = P.photoItems(rows);
    // Video, favorit, dold, skärmdump, papperskorgen.
    assert.deepStrictEqual(items.map((i) => i.pk + ':' + [i.video, i.favorite, i.hidden, i.screenshot, i.trashed].map(Number).join('')), ['1:01000', '2:10000', '3:00010', '4:00000', '5:00100', '6:00001']);
    const names = { 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.springboard': 'Hemskärmen' };
    const groups = P.galleryGroups(items, albums, (id) => names[id] || id, 'iOS');
    assert.deepStrictEqual(groups.map((g) => g.title + ': ' + g.list.map((x) => x.title + ' ' + x.count + '@' + x.cover).join(', ')), [
        'Mina album: Resan 2@0, Snapchat 1@3',
        'Mediatyper: Videor 1@1, Skärmdumpar 1@2, Favoriter 1@0',
        'Sparat av app: Hemskärmen 1@2, Snapchat 1@3',
        'Övrigt: Dolda 1@4, Nyligen raderade 1@5',
    ]);
    assert.deepStrictEqual(P.filterItems(items, 'app:com.toyopagroup.picaboo').map((i) => i.pk), [4], 'papperskorgen är inte med');
    assert.deepStrictEqual(P.filterItems(items, 'trashed').map((i) => i.pk), [6]);
    assert.deepStrictEqual(P.filterItems(items, 'album:20').map((i) => i.pk), [1, 2]);
    assert.strictEqual(P.filterById(items, albums, 'album:21').title, 'Snapchat');
    assert.strictEqual(P.filterById(items, albums, 'hidden').title, 'Dolda');
    // Android: mapparna är albumen.
    const and = P.photoItems([{ relativePath: 'DCIM/Camera/', filename: 'a.jpg', album: 'Camera', createdMs: 2, mediaType: 1 }, { relativePath: 'DCIM/Snapchat/', filename: 'b.mp4', createdMs: 1, mediaType: 3, importer: 'com.snapchat.android' }]);
    const ag = P.galleryGroups(and, [], (id) => id, 'Android');
    assert.deepStrictEqual(ag.map((g) => g.title + ': ' + g.list.map((x) => x.title).join(', ')), ['Mappar: Camera, Snapchat', 'Mediatyper: Videor', 'Sparat av app: com.snapchat.android']);
});
