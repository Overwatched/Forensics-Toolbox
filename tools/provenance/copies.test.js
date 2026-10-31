// "Var finns filen?": platsens betydelse, dubbletter på storlek och CRC32, och keep-filtret
// till zip-genomgången.

const test = require('node:test');
const assert = require('node:assert');
const copies = require('./copies');

const P = 'filesystem1/private/var/mobile/';

test('platsens betydelse för iOS- och Android-sökvägar', () => {
    const c = (n) => copies.classifyPath(n);
    assert.strictEqual(c(P + 'Media/DCIM/100APPLE/IMG_0015.MOV').area, 'library');
    assert.strictEqual(c(P + 'Media/PhotoData/CPLAssets/group133/C70C41C6.MP4').label, 'Bildbiblioteket, iCloud-original (CPLAssets)');
    assert.strictEqual(c(P + 'Media/PhotoData/Thumbnails/V2/x.JPG').label, 'Bildbiblioteket, tumnagel eller cache');
    assert.strictEqual(c(P + 'Containers/Data/Application/61AE6288-182A-4DBE-A56C-CA2590D52576/Documents/com.snap.file_manager_3_SCContent_6477/25bb').label, 'Snapchat, cache (file_manager)');
    assert.strictEqual(c(P + 'Containers/Data/Application/61AE6288-182A-4DBE-A56C-CA2590D52576/Library/Caches/user_scoped/2b12/recorded_videos/recorded-1.mp4').area, 'snapchat');
    assert.strictEqual(c(P + 'Library/SMS/Attachments/a3/03/FA4D/IMG.HEIC').label, 'iMessage/SMS-bilaga');
    assert.strictEqual(c(P + 'Containers/Shared/AppGroup/1A79BE73-8D07-45B5-BC79-BBB0DFC3B273/File Provider Storage/photospicker/uuid=22.pvt/IMG.MOV').area, 'picker');
    assert.strictEqual(c(P + 'Containers/Shared/AppGroup/9B130154-B641-4454-B8CB-DDED0F382A08/User/x/extensionGeneralCache/abc').label, 'Appgrupp 9B130154-B641-4454-B8CB-DDED0F382A08');
    assert.strictEqual(c(P + 'Containers/Data/PluginKitPlugin/952C8516-073A-4B07-9FA4-22A9031C7D78/tmp/7791.MOV').label, 'Apptillägg 952C8516-073A-4B07-9FA4-22A9031C7D78');
    assert.strictEqual(c(P + 'Containers/Data/Application/AAAAAAAA-0000-0000-0000-000000000000/Documents/x.jpg').label, 'Appbehållare AAAAAAAA-0000-0000-0000-000000000000');
    assert.strictEqual(c('data/media/0/DCIM/Camera/PXL_1.jpg').label, 'Kameran (DCIM/Camera)');
    assert.strictEqual(c('data/media/0/Pictures/Snapchat/Snapchat-123.jpg').area, 'snapchat');
    assert.deepStrictEqual(c('data/media/0/DCIM/Snapchat/Snapchat-1788669324.jpg'), { label: 'Snapchat, sparade till galleriet (DCIM/Snapchat)', plain: 'bland Snapchats bilder i galleriet', area: 'library' });
    assert.strictEqual(c('data/data/com.snapchat.android/files/native_content_manager/com.snap.file_manager_3_SCContent_d57a4e83-bf02-4da2-8fb7-ca65be939d22/15116568751943e94ff764a3d4c183d5').label, 'Snapchat, cache (file_manager)');
    assert.strictEqual(c('data/data/com.snapchat.android/files/file_manager/chat_snap/x').label, 'Snapchat, appens data: com.snapchat.android');
    assert.strictEqual(c(P + 'Containers/Data/Application/61AE6288-182A-4DBE-A56C-CA2590D52576/Library/Caches/com.toyopagroup.picaboo/Cache.db').area, 'snapchat');
    assert.strictEqual(c('data/media/0/Android/data/com.whatsapp/cache/x.jpg').label, 'Appens lagring: com.whatsapp');
    assert.strictEqual(c('something/else').label, 'Annan plats');
});

test('Snapchats egna behållare känns igen när GUID:erna pekas ut', () => {
    const opts = { snapchatContainers: ['61ae6288-182a-4dbe-a56c-ca2590d52576', '9B130154-B641-4454-B8CB-DDED0F382A08'] };
    const c = (n) => copies.classifyPath(n, opts);
    assert.deepStrictEqual(c(P + 'Containers/Data/Application/61AE6288-182A-4DBE-A56C-CA2590D52576/Library/Caches/5A1F0C3E.mp4'), { label: 'Snapchat, appbehållare 61AE6288-182A-4DBE-A56C-CA2590D52576', plain: 'i Snapchat', area: 'snapchat' });
    assert.strictEqual(c(P + 'Containers/Shared/AppGroup/9B130154-B641-4454-B8CB-DDED0F382A08/User/x/y').label, 'Snapchat, appgrupp 9B130154-B641-4454-B8CB-DDED0F382A08');
    assert.strictEqual(c(P + 'Containers/Data/Application/AAAAAAAA-0000-0000-0000-000000000000/Library/Caches/x.mp4').area, 'app');
    assert.strictEqual(copies.classifyPath(P + 'Containers/Data/Application/61AE6288-182A-4DBE-A56C-CA2590D52576/Library/Caches/5A1F0C3E.mp4').area, 'app', 'utan GUID:er är behållaren vilken app som helst');
    // Sorteringen och förklaringsmeningen följer med.
    const file = { name: 'a/file', size: 1, crc32: 2 };
    const entries = [file, { name: P + 'Containers/Data/Application/61AE6288-182A-4DBE-A56C-CA2590D52576/Library/Caches/5A1F0C3E.mp4', size: 1, crc32: 2 }, { name: P + 'Library/SMS/Attachments/a/b.mp4', size: 1, crc32: 2 }];
    assert.deepStrictEqual(copies.findCopies(entries, file, opts).map((e) => e.name.includes('SMS')), [false, true]);
    assert.deepStrictEqual(copies.findCopies(entries, file).map((e) => e.name.includes('SMS')), [true, false]);
    assert.strictEqual(copies.plainSentence([{ name: 'x', plain: 'i Snapchat' }, { name: 'y', plain: 'i Snapchat' }]), 'Exakt samma fil finns också i Snapchat.');
});

test('dubbletter hittas på storlek och CRC32, filen själv räknas inte, bildbiblioteket först', () => {
    const G = '61AE6288-182A-4DBE-A56C-CA2590D52576';
    const file = { name: P + 'Containers/Data/Application/' + G + '/Documents/com.snap.file_manager_3_SCContent_6/25bb', size: 2986688, crc32: 0x61110a18 };
    const entries = [
        file,
        { name: P + 'Containers/Data/Application/' + G + '/Library/Caches/D05F.mp4', size: 2986688, crc32: 0x61110a18 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0099.MOV', size: 2986688, crc32: 0x61110a18 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0015.MOV', size: 2986688, crc32: 0x11111111 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0016.MOV', size: 1, crc32: 0x61110a18 },
        { name: P + 'Media/DCIM/', size: 2986688, crc32: 0x61110a18 },
    ];
    const out = copies.findCopies(entries, file);
    assert.deepStrictEqual(out.map((e) => e.name.slice(P.length)), ['Media/DCIM/100APPLE/IMG_0099.MOV', 'Containers/Data/Application/' + G + '/Library/Caches/D05F.mp4']);
    assert.strictEqual(copies.plainSentence(out), 'Exakt samma fil finns också i bildbiblioteket och i en apps egen lagring.');
    assert.strictEqual(copies.plainSentence([]), '');
});

test('keep-filtret sparar samma storlek+CRC32 och sökta filnamn, inte mappar', () => {
    const keep = copies.keeper(100, 0xabc, ['IMG_0001.HEIC']);
    assert.strictEqual(keep('a/b/c', 100, 0xabc), true);
    assert.strictEqual(keep('a/b/c', 100, 0xabd), false);
    assert.strictEqual(keep('a/b/img_0001.heic', 5, 1), true);
    assert.strictEqual(keep('a/b/IMG_0001.HEIC/', 100, 0xabc), false);
    const onlyName = copies.keeper(null, null, ['x.jpg']);
    assert.strictEqual(onlyName('q/X.JPG', 1, 1), true);
    assert.strictEqual(onlyName('q/y.jpg', 1, 1), false);
});

test('träffar på filnamn sorteras med kortast sökväg först', () => {
    const entries = [{ name: 'a/b/c/IMG_1.JPG', size: 1, crc32: 1 }, { name: 'x/IMG_1.JPG', size: 1, crc32: 1 }, { name: 'x/img_2.jpg', size: 1, crc32: 1 }];
    assert.deepStrictEqual(copies.byName(entries, 'img_1.jpg').map((e) => e.name), ['x/IMG_1.JPG', 'a/b/c/IMG_1.JPG']);
    assert.deepStrictEqual(copies.byName(entries, ''), []);
});
