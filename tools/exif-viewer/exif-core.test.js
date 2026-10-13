const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const core = require('./exif-core.js');

// Utdrag ur ExifTool 13.42 (-json -a -G1 -s) för riktiga filer.
const IPHONE_HEIC = {
    'SourceFile': '/IMG_5195.HEIC',
    'System:FileName': 'IMG_5195.HEIC',
    'System:FileModifyDate': '2023:11:14 22:13:20+00:00',
    'File:FileType': 'HEIC',
    'File:FileTypeExtension': 'heic',
    'File:MIMEType': 'image/heic',
    'IFD0:Make': 'Apple',
    'IFD0:Model': 'iPhone 11 Pro Max',
    'IFD0:Software': '14.4.2',
    'IFD0:ModifyDate': '2021:04:11 15:47:53',
    'ExifIFD:DateTimeOriginal': '2021:04:11 15:47:53',
    'ExifIFD:OffsetTimeOriginal': '-05:00',
    'Composite:SubSecDateTimeOriginal': '2021:04:11 15:47:53.054-05:00',
    'Composite:GPSLatitude': '39 deg 3\' 4.84" N',
    'Composite:GPSLongitude': '94 deg 17\' 19.58" W',
};

const PHOTOSHOP_JPG = {
    'File:FileType': 'JPEG',
    'File:FileTypeExtension': 'jpg',
    'File:MIMEType': 'image/jpeg',
    'IFD0:Software': 'Adobe Photoshop 22.5 (Windows)',
    'IFD0:ModifyDate': '2022:02:16 14:29:06',
    'XMP-xmp:CreatorTool': 'Adobe Photoshop 23.1 (Windows)',
    'XMP-xmp:CreateDate': '2022:02:07 12:12:53-08:00',
    'XMP-xmpMM:HistoryAction': 'saved',
};

const FFMPEG_MOV = {
    'File:FileType': 'MOV',
    'File:FileTypeExtension': 'mov',
    'File:MIMEType': 'video/quicktime',
    'QuickTime:CreateDate': '2024:06:01 12:34:56',
    'UserData:SoftwareVersion': 'Lavf62.12.103',
    'UserData:GPSCoordinates': '59 deg 19\' 45.48" N, 18 deg 4\' 6.96" E',
};

function flagIds(summary) {
    return summary.flags.map((f) => f.id).sort();
}

test('sammanfattar en iPhone-bild med tid, enhet och position', () => {
    const s = core.summarize(IPHONE_HEIC, 'IMG_5195.HEIC');
    assert.strictEqual(s.type, 'HEIC');
    assert.strictEqual(s.taken.text, '2021-04-11 15:47:53.054 -05:00');
    assert.strictEqual(s.taken.source, 'Composite:SubSecDateTimeOriginal');
    assert.strictEqual(s.device.text, 'Apple iPhone 11 Pro Max');
    assert.strictEqual(s.software.text, '14.4.2');
    assert.deepStrictEqual([s.position.lat, s.position.lon], [39.051344, -94.288772]);
    assert.deepStrictEqual(flagIds(s), ['gps']);
});

test('ExifIFD:DateTimeOriginal får tidszon från OffsetTimeOriginal', () => {
    const s = core.summarize({ 'ExifIFD:DateTimeOriginal': '2024:06:01 14:34:56', 'ExifIFD:OffsetTimeOriginal': '+02:00' }, 'a.jpg');
    assert.strictEqual(s.taken.text, '2024-06-01 14:34:56 +02:00');
});

test('QuickTime-tid märks som UTC och GPS läses ur UserData', () => {
    const s = core.summarize(FFMPEG_MOV, 'video.mov');
    assert.strictEqual(s.taken.text, '2024-06-01 12:34:56 UTC');
    assert.strictEqual(s.software.text, 'Lavf62.12.103');
    assert.strictEqual(s.position.source, 'UserData:GPSCoordinates');
    assert.ok(Math.abs(s.position.lat - 59.3293) < 0.001);
});

test('nolldatum hoppas över', () => {
    const s = core.summarize({ 'QuickTime:CreateDate': '0000:00:00 00:00:00', 'Keys:CreationTime': '2024:06:01 12:34:56Z' }, 'v.mp4');
    assert.strictEqual(s.taken.source, 'Keys:CreationTime');
    assert.strictEqual(s.taken.text, '2024-06-01 12:34:56 UTC');
});

test('Photoshop-bild flaggas som redigerad', () => {
    const s = core.summarize(PHOTOSHOP_JPG, 'plain.jpg');
    assert.ok(flagIds(s).includes('edited'));
    assert.match(s.flags.find((f) => f.id === 'edited').reason, /Photoshop/);
});

test('JPEG utan EXIF flaggas, PNG utan EXIF gör det inte', () => {
    const jpeg = core.summarize({ 'File:FileType': 'JPEG', 'File:FileTypeExtension': 'jpg', 'File:MIMEType': 'image/jpeg' }, 'IMG-20240601-WA0007.jpg');
    assert.deepStrictEqual(flagIds(jpeg), ['app', 'stripped']);
    assert.deepStrictEqual(jpeg.apps, ['whatsapp']);
    const png = core.summarize({ 'File:FileType': 'PNG', 'File:FileTypeExtension': 'png', 'File:MIMEType': 'image/png' }, 'logo.png');
    assert.deepStrictEqual(flagIds(png), []);
});

test('fel filändelse upptäcks men inte för Office-filer eller jpeg/jpg', () => {
    assert.strictEqual(core.extensionMismatch('bild.jpg', 'png'), true);
    assert.strictEqual(core.extensionMismatch('bild.jpeg', 'jpg'), false);
    assert.strictEqual(core.extensionMismatch('bild.HEIF', 'heic'), false);
    assert.strictEqual(core.extensionMismatch('rapport.docx', 'zip'), false);
    assert.strictEqual(core.extensionMismatch('utan-andelse', 'jpg'), false);
    const s = core.summarize({ 'File:FileType': 'PNG', 'File:FileTypeExtension': 'png', 'File:MIMEType': 'image/png' }, 'IMG_0001.JPG');
    assert.ok(s.mismatch);
    assert.match(s.flags[0].reason, /PNG/);
});

test('skärmdumpar känns igen på UserComment och filnamn', () => {
    assert.ok(flagIds(core.summarize({ 'ExifIFD:UserComment': 'Screenshot' }, 'IMG_0042.PNG')).includes('screenshot'));
    assert.ok(flagIds(core.summarize({}, 'Screenshot_20240101-120000_WhatsApp.jpg')).includes('screenshot'));
    assert.ok(flagIds(core.summarize({}, 'Skärmavbild 2024-01-01 kl. 12.00.00.png')).includes('screenshot'));
});

test('filnamnsmönster pekar på poster i App-ID', () => {
    const AppIds = require('../app-ids/catalog.js');
    const names = [
        'IMG-20240101-WA0001.jpg', 'VID-20240101-WA0002.mp4', 'received_1234567890123.jpeg', 'FB_IMG_1700000000000.jpg',
        'Snapchat-123456789.jpg', 'signal-2024-01-01-120000.jpg', 'photo_2024-01-01_12-00-00.jpg', 'PXL_20240101_120000123.jpg',
        'InShot_20240101_120000.mp4', 'lv_0_20240101120000.mp4', '20240101_120000.jpg',
    ];
    for (const name of names) {
        const apps = core.filenameApps(name);
        assert.strictEqual(apps.length, 1, name);
        assert.ok(AppIds.APPS.some((a) => a.id === apps[0]), apps[0] + ' finns inte i App-ID');
    }
    assert.deepStrictEqual(core.filenameApps('IMG_1234.HEIC'), []);
});

test('filnamnsmönster jämförs med tillverkaren i metadata', () => {
    const samsung = core.filenameMatches('20240601_142201.jpg', { 'IFD0:Make': 'samsung', 'IFD0:Model': 'SM-S918B' })[0];
    assert.strictEqual(samsung.strength, 'svag');
    assert.strictEqual(samsung.makerMatch, 'match');
    assert.match(core.describePattern(samsung, 'Samsung Kamera'),
        /Samsung Kamera — filnamnet följer mönstret ÅÅÅÅMMDD_TTMMSS \(används även av andra Android-kameror\)\. Uppgiften kommer från filnamnet, inte från metadata\. Stämmer med Make: samsung\./);

    const renamed = core.filenameMatches('20240601_142201.jpg', { 'IFD0:Make': 'Apple', 'IFD0:Model': 'iPhone 15 Pro' })[0];
    assert.strictEqual(renamed.makerMatch, 'mismatch');
    assert.match(core.describePattern(renamed, 'Samsung Kamera'), /Stämmer inte med enheten i metadata/);

    const noDevice = core.filenameMatches('20240601_142201.jpg', {})[0];
    assert.strictEqual(noDevice.makerMatch, null);
    const flag = core.summarize({}, 'PXL_20240101_120000123.jpg').flags.find((f) => f.id === 'app');
    assert.strictEqual(flag.label, 'Filnamnsmönster');
    assert.strictEqual(flag.patterns[0].strength, 'stark');
});

test('koordinater tolkas från grader, minuter och sekunder', () => {
    assert.strictEqual(core.parseCoord('59.3293'), 59.3293);
    assert.ok(Math.abs(core.parseCoord('33 deg 52\' 10.20" S') + 33.8695) < 1e-4);
    assert.strictEqual(core.parseCoord(''), null);
    assert.strictEqual(core.parseCoord('okänd'), null);
});

test('minnesfilsystemets fält tas bort', () => {
    const clean = core.cleanTags(IPHONE_HEIC);
    assert.ok(!('SourceFile' in clean));
    assert.ok(!('System:FileModifyDate' in clean));
    assert.ok('IFD0:Make' in clean);
    const groups = core.groupTags(clean).map((g) => g.group);
    assert.deepStrictEqual(groups, ['File', 'IFD0', 'ExifIFD', 'Composite']);
});

test('CSV skyddar mot formler och citerar fält', () => {
    const csv = core.toCsv([{
        path: 'mapp/=HYPERLINK("x").jpg', size: 10, modified: '2024-01-01 12:00:00 +01:00',
        summary: core.summarize(IPHONE_HEIC, 'IMG_5195.HEIC'),
    }]);
    const [header, line] = csv.trim().split('\r\n');
    assert.match(header, /^sokvag,storlek_byte,/);
    assert.ok(line.startsWith('"mapp/=HYPERLINK(""x"").jpg",10,'), line);
    const evil = core.toCsv([{ path: '=cmd', size: 1, modified: '', summary: core.summarize({}, '=cmd') }]);
    assert.ok(evil.split('\r\n')[1].startsWith("'=cmd"));
});

// Bygger en minimal ZIP med deflate, som en .docx.
function makeZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
        const nameBuf = Buffer.from(name);
        const data = zlib.deflateRawSync(Buffer.from(text));
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(Buffer.byteLength(text), 22);
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, data);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(Buffer.byteLength(text), 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);
        offset += 30 + nameBuf.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 8);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}

test('Office-egenskaper läses ur docProps', async () => {
    const zip = makeZip({
        '[Content_Types].xml': '<Types/>',
        'docProps/core.xml': '<cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z"><dc:creator>Anna &amp; Bo</dc:creator>'
            + '<cp:lastModifiedBy>Eva</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-02T09:00:00Z</dcterms:created>'
            + '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-03T10:30:00Z</dcterms:modified><cp:revision>4</cp:revision></cp:coreProperties>',
        'docProps/app.xml': '<Properties><Application>Microsoft Office Word</Application><Company>Bolaget AB</Company><TotalTime>42</TotalTime></Properties>',
    });
    const readRange = async (s, e) => new Uint8Array(zip.subarray(s, e));
    const inflate = async (b) => new Uint8Array(zlib.inflateRawSync(b));
    const files = await core.readZipEntries(zip.length, readRange, inflate, core.OFFICE_FILES);
    assert.deepStrictEqual(Object.keys(files).sort(), ['docProps/app.xml', 'docProps/core.xml']);
    const tags = core.officeTags(files);
    assert.strictEqual(tags['Office:Creator'], 'Anna & Bo');
    assert.strictEqual(tags['Office:LastModifiedBy'], 'Eva');
    assert.strictEqual(tags['Office:Company'], 'Bolaget AB');
    assert.strictEqual(tags['Office:TotalEditTimeMinutes'], '42');

    const s = core.summarize(Object.assign({
        'File:FileType': 'ZIP', 'File:FileTypeExtension': 'zip', 'File:MIMEType': 'application/zip',
        'ExifTool:Warning': 'Install Archive::Zip to decode compressed ZIP information',
    }, tags), 'rapport.docx');
    assert.strictEqual(s.type, 'DOCX');
    assert.strictEqual(s.taken.text, '2024-01-02 09:00:00 UTC');
    assert.strictEqual(s.software.text, 'Microsoft Office Word');
    assert.deepStrictEqual(flagIds(s), []);
});

test('trasig ZIP ger inga Office-fält', async () => {
    const junk = Buffer.from('PK inte en riktig zip');
    const files = await core.readZipEntries(junk.length, async (s, e) => new Uint8Array(junk.subarray(s, e)), async (b) => b, core.OFFICE_FILES);
    assert.deepStrictEqual(files, {});
});
