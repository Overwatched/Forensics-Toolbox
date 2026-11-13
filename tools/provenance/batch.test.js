// Flera filer i Härkomst: inklistrade namn, raden per fil och undersökarens läge.

const test = require('node:test');
const assert = require('node:assert');
const B = require('./batch');

test('namnen: ett per rad, med komma eller semikolon, sökvägar blir filnamn, dubbletter bort', () => {
    assert.deepStrictEqual(B.parseNames('IMG_0042.HEIC\nIMG_0043.PNG\r\n\nIMG_0042.HEIC\n'), ['IMG_0042.HEIC', 'IMG_0043.PNG']);
    assert.deepStrictEqual(B.parseNames('IMG_1.JPG, IMG_2.JPG;IMG_3.JPG'), ['IMG_1.JPG', 'IMG_2.JPG', 'IMG_3.JPG']);
    assert.deepStrictEqual(B.parseNames('/private/var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC\nC:\\Export\\Fall 12\\bild.jpg'), ['IMG_0042.HEIC', 'bild.jpg']);
    assert.deepStrictEqual(B.parseNames('"IMG_0042.HEIC"\t“IMG_0043.PNG”'), ['IMG_0042.HEIC', 'IMG_0043.PNG']);
    assert.deepStrictEqual(B.parseNames('IMG_0042.HEIC'), ['IMG_0042.HEIC']);
    assert.deepStrictEqual(B.parseNames('  '), []);
    assert.deepStrictEqual(B.parseNames(null), []);
});

test('ett komma i ett filnamn delar inte namnet', () => {
    assert.deepStrictEqual(B.parseNames('Bild, kopia.jpg'), ['Bild, kopia.jpg']);
    assert.deepStrictEqual(B.parseNames('Bild, kopia.jpg\nIMG_1.JPG'), ['Bild, kopia.jpg', 'IMG_1.JPG']);
    assert.deepStrictEqual(B.parseNames('Skärmavbild 2026-10-31 kl. 14.30.00.png'), ['Skärmavbild 2026-10-31 kl. 14.30.00.png']);
});

test('hashsummor: med komma, mellanslag eller en per rad, och en rad ur md5sum', () => {
    const md5 = 'd41d8cd98f00b204e9800998ecf8427e';
    const sha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    assert.deepStrictEqual(B.parseNames(md5 + ', ' + sha1), [md5, sha1]);
    assert.deepStrictEqual(B.parseNames(md5 + ' ' + sha256.toUpperCase()), [md5, sha256.toUpperCase()]);
    assert.deepStrictEqual(B.parseNames(md5 + '  IMG_0042.HEIC\n' + sha256 + ' *Bild kopia.jpg'), [md5, sha256]);
    assert.deepStrictEqual(B.parseNames('IMG_1.JPG, ' + md5), ['IMG_1.JPG', md5]);
    assert.deepStrictEqual(B.parseNames('c59503f8d37f48cc8a3aefb4aba984fb'), ['c59503f8d37f48cc8a3aefb4aba984fb']);
});

test('raden i listan ur en bedömning', () => {
    const model = {
        file: { filename: 'IMG_0042.HEIC', createdMs: Date.UTC(2026, 9, 20, 12, 3, 11), pk: 42 },
        type: { type: 'camera', label: 'Kamerabild' },
        factors: [{ id: 'time', title: 'Skapandetid', state: 'support' }, { id: 'camera', title: 'Kamera igång', state: 'missing' }],
        summary: 'Underlaget är förenligt med en kamerabild.', warnings: ['en varning'], beta: false,
    };
    const meta = { fileEntry: { path: 'private/var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC', md5: 'aa', sha256: 'bb' } };
    const row = B.summarize(model, meta, { format: (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' '), zoneLabel: 'UTC', place: 'Bildbiblioteket (DCIM)', key: 'k' });
    assert.strictEqual(row.tText, '2026-10-20 12:03:11');
    assert.strictEqual(row.typeLabel, 'Kamerabild');
    assert.strictEqual(row.factors.time.state, 'support');
    assert.strictEqual(row.factors.camera.title, 'Kamera igång');
    assert.deepStrictEqual(row.factorIds, ['time', 'camera']);
    assert.strictEqual(row.sha256, 'bb');
    assert.strictEqual(row.warnings, 1);
    assert.strictEqual(row.key, 'k');
    const bare = B.summarize({ file: { filename: 'x.jpg' }, factors: [] }, { fileMissingReason: 'Bildfilen lästes inte: filen finns inte i zippen.' }, {});
    assert.strictEqual(bare.path, '');
    assert.strictEqual(bare.fileNote, 'Bildfilen lästes inte: filen finns inte i zippen.');
    assert.strictEqual(bare.tText, '');
});

test('undersökarens läge per fil', () => {
    const ids = ['time', 'app', 'camera', 'screen', 'position'];
    assert.strictEqual(B.examinerText(null, ids), 'Inte bedömd');
    assert.strictEqual(B.examinerText({ text: '  ', checked: {} }, ids), 'Inte bedömd');
    assert.strictEqual(B.examinerText({ text: 'Tagen med kameran.', checked: { time: 1, app: 2, camera: 3 } }, ids), 'Bedömd, 3 av 5 kontrollerade');
    assert.strictEqual(B.examinerText({ text: 'Tagen med kameran.', checked: {} }, ids), 'Bedömd');
    assert.strictEqual(B.examinerText({ text: '', checked: { time: 1, gone: 2 } }, ids), '1 av 5 kontrollerade, ingen text');
    assert.deepStrictEqual(B.counts([{ status: 'done' }, { status: 'done' }, { status: 'missing' }, { status: 'ambiguous' }]), { done: 2, missing: 1, ambiguous: 1, error: 0, stopped: 0, waiting: 0 });
});

const MD5 = '0123456789abcdef0123456789abcdef';
const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('lista: ett namn eller en summa per rad, kommentarer och tomma rader bort, dubbletter bort', () => {
    const r = B.parseList('\uFEFF# från ärendet\r\nIMG_0042.HEIC\r\n\r\n' + MD5 + '\r\nIMG_0042.HEIC\r\n/private/var/mobile/Media/DCIM/100APPLE/IMG_0043.PNG\r\n');
    assert.deepStrictEqual(r.names, ['IMG_0042.HEIC', MD5, 'IMG_0043.PNG']);
    assert.strictEqual(r.hashes, 1);
    assert.strictEqual(r.files, 2);
    assert.strictEqual(r.column, '');
});

test('lista: utdata från md5sum, shasum och BSD md5', () => {
    assert.deepStrictEqual(B.parseList(MD5 + '  IMG_1.JPG\n' + SHA1 + ' *IMG_2.JPG\nMD5 (IMG 3.JPG) = ' + MD5.toUpperCase() + '\nSHA256 (x.jpg) = ' + SHA256).names, [MD5, SHA1, MD5.toUpperCase(), SHA256]);
});

test('lista: en tabell med rubrik använder summan före namnet', () => {
    const csv = 'Filnamn;MD5;Storlek\nIMG_1.JPG;' + MD5 + ';123\nIMG_2.JPG;;456\n;;789\n';
    const r = B.parseList(csv);
    assert.deepStrictEqual(r.names, [MD5, 'IMG_2.JPG'], 'en rad utan summa tar namnet');
    assert.strictEqual(r.column, 'MD5');
    assert.strictEqual(r.skipped, 1);
});

test('lista: en tabell med bara filnamn, med citattecken, sökväg och komma i namnet', () => {
    const r = B.parseList('"Path","Size"\n"C:\\Export\\Bild, kopia.jpg",12\n"/a/b/IMG_2.JPG",13\n');
    assert.deepStrictEqual(r.names, ['Bild, kopia.jpg', 'IMG_2.JPG']);
    assert.strictEqual(r.column, 'Path');
    const tsv = B.parseList('ZFILENAME\tZDATECREATED\nIMG_1.HEIC\t783786259\n');
    assert.deepStrictEqual(tsv.names, ['IMG_1.HEIC']);
});

test('lista: en CSV-fil ur Queries, med kommentarer överst', () => {
    const r = B.parseList('\uFEFF# Forensics Toolbox, Queries 2026-11-04\r\n# Databas: Photos.sqlite\r\n# SQL:\r\n# SELECT ZFILENAME FROM ZASSET\r\nZFILENAME,ZKIND\r\nIMG_1.HEIC,0\r\nIMG_2.MOV,1\r\n');
    assert.deepStrictEqual(r.names, ['IMG_1.HEIC', 'IMG_2.MOV']);
});

test('lista: hashdeep, med huvud och flera summor på raden', () => {
    const r = B.parseList('%%%% HASHDEEP-1.0\n%%%% size,md5,sha256,filename\n## Invoked from: /tmp\n123,' + MD5 + ',' + SHA256 + ',/tmp/IMG_1.JPG\n');
    assert.deepStrictEqual(r.names, [MD5]);
});

test('lista utan rubrik: en rad är en fil, utom när den bara har namn eller bara summor', () => {
    assert.deepStrictEqual(B.parseList('IMG_1.JPG,' + MD5).names, [MD5], 'namn och summa är samma fil');
    assert.deepStrictEqual(B.parseList(MD5 + ',' + SHA1).names, [MD5, SHA1]);
    assert.deepStrictEqual(B.parseList('a.jpg;b.jpg').names, ['a.jpg', 'b.jpg']);
    assert.deepStrictEqual(B.parseList('IMG_1.JPG,12345,2024-06-01').names, ['IMG_1.JPG']);
    assert.deepStrictEqual(B.parseList('Bild, kopia.jpg').names, ['Bild, kopia.jpg']);
    assert.deepStrictEqual(B.parseList('7d1f3a9c2b4e').names, ['7d1f3a9c2b4e'], 'ett namn utan ändelse, som Snapchats cachenycklar');
});

test('lista: en okänd rubrik hoppas över när nästa rad har ett filnamn', () => {
    assert.deepStrictEqual(B.parseList('Bildnamn,Storlek\nIMG_1.JPG,12\n').names, ['IMG_1.JPG']);
    assert.deepStrictEqual(B.parseList('Filnamn\nIMG_1.JPG\nkey123\n').names, ['IMG_1.JPG', 'key123'], 'en rubrik med en kolumn');
    assert.deepStrictEqual(B.parseList('').names, []);
    assert.deepStrictEqual(B.parseList('# bara kommentarer').names, []);
    assert.deepStrictEqual(B.parseList('md5\n').names, []);
});

test('lista: vilka filer som räknas som listor och hur de avkodas', () => {
    for (const n of ['lista.txt', 'x.CSV', 'a.tsv', 'b.md5', 'c.sha256', 'd.lst']) assert.ok(B.isListFile(n), n);
    for (const n of ['IMG_1.JPG', 'video.mov', 'utan-andelse', 'lista.xlsx']) assert.ok(!B.isListFile(n), n);
    assert.ok(B.isOfficeFile('lista.xlsx') && B.isOfficeFile('a.pdf') && !B.isOfficeFile('a.csv'));
    const enc = (s) => new TextEncoder().encode(s);
    assert.strictEqual(B.decodeList(enc('Bild å.jpg')), 'Bild å.jpg');
    assert.strictEqual(B.decodeList(new Uint8Array([0x42, 0xe5, 0x2e, 0x6a, 0x70, 0x67])), 'Bå.jpg', 'Windows-1252 ur Excel');
    assert.strictEqual(B.decodeList(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])), 'AB');
    assert.strictEqual(B.decodeList(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42])), 'AB');
    assert.ok(B.looksLikeText(enc('IMG_1.JPG\n')));
    assert.ok(B.looksLikeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00])));
    assert.ok(!B.looksLikeText(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), 'en JPEG är inte text');
});

// Raderna i listan som urvalet och sökningen prövas mot. Värdena är påhittade.
function listRow(name, status, more) {
    return Object.assign({ item: { kind: 'name', name }, name, status, note: '', summary: null }, more || {});
}
const done = (name, factors, more) => listRow(name, 'done', { summary: Object.assign({ filename: name, path: 'private/var/mobile/Media/DCIM/100APPLE/' + name, place: 'Bildbiblioteket (DCIM)',
    typeLabel: 'Kamerabild', tText: '2026-03-01 14:02:33', summary: 'Materialet är förenligt med att bilden togs med den här telefonens kamera.', factors }, more || {}) });
const ROWS = [
    done('IMG_1.JPG', { time: { state: 'support' }, app: { state: 'missing' } }),
    done('IMG_2.JPG', { time: { state: 'support' }, app: { state: 'contradiction' } }, { typeLabel: 'Sparad ur en app', summary: 'Det går inte att bedöma att filen sparades på den här telefonen av Exempelappen.' }),
    listRow('IMG_3.JPG', 'ambiguous', { note: '2 rader i Photos.sqlite har det namnet. Öppna raden och välj.' }),
    listRow('borta.jpg', 'missing', { note: 'Finns varken i bildbiblioteket eller någon annanstans i zippen.' }),
    listRow('trasig.jpg', 'error', { note: 'Filen gick inte att läsa.' }),
];

test('urvalet: grupperna räknas, och en fil med en faktor som inte är förenlig hör till sin egen grupp', () => {
    assert.deepStrictEqual(B.groupCounts(ROWS), { '': 5, done: 2, contradiction: 1, ambiguous: 1, missing: 1, error: 1, stopped: 0 });
    assert.deepStrictEqual(B.groupCounts([]), { '': 0, done: 0, contradiction: 0, ambiguous: 0, missing: 0, error: 0, stopped: 0 });
    const names = (filter) => ROWS.filter((r) => B.matches(r, filter)).map((r) => r.name);
    assert.deepStrictEqual(names({ group: 'contradiction' }), ['IMG_2.JPG']);
    assert.deepStrictEqual(names({ group: 'done' }), ['IMG_1.JPG', 'IMG_2.JPG']);
    assert.deepStrictEqual(names({ group: 'ambiguous' }), ['IMG_3.JPG']);
    assert.deepStrictEqual(names({}), ROWS.map((r) => r.name));
    assert.deepStrictEqual(names(null), ROWS.map((r) => r.name));
    // Varje grupp har ett ord, och varje läge ett tecken och en förklaring.
    assert.deepStrictEqual(B.GROUPS.map((g) => g[0]), ['', 'done', 'contradiction', 'ambiguous', 'missing', 'error', 'stopped']);
    assert.deepStrictEqual(B.STATE_MEANING.map((m) => m[0]).sort(), Object.keys(B.STATE_SIGN).sort());
    assert.strictEqual(new Set(Object.values(B.STATE_SIGN)).size, 5, 'två lägen har samma tecken');
});

test('sökningen i listan: varje ord ska finnas på raden, oavsett skiftläge, tillsammans med gruppen', () => {
    const names = (filter) => ROWS.filter((r) => B.matches(r, filter)).map((r) => r.name);
    assert.deepStrictEqual(names({ text: 'img_2' }), ['IMG_2.JPG']);
    assert.deepStrictEqual(names({ text: '  100apple   kamerabild ' }), ['IMG_1.JPG'], 'mappen och typen, i valfri ordning');
    assert.deepStrictEqual(names({ text: '14:02' }), ['IMG_1.JPG', 'IMG_2.JPG'], 'tiden');
    assert.deepStrictEqual(names({ text: 'exempelappen' }), ['IMG_2.JPG'], 'appen står i sammanvägningen');
    assert.deepStrictEqual(names({ text: 'finns inte' }), ['borta.jpg'], 'radens läge');
    assert.deepStrictEqual(names({ text: 'photos.sqlite' }), ['IMG_3.JPG'], 'det som står på raden');
    assert.deepStrictEqual(names({ text: 'img', group: 'done' }), ['IMG_1.JPG', 'IMG_2.JPG']);
    assert.deepStrictEqual(names({ text: 'img_1', group: 'contradiction' }), []);
    assert.deepStrictEqual(names({ text: 'finns-ingenstans' }), []);
    // En rad som söktes med en hashsumma hittas på summan, och en träff på sin sökväg.
    const hash = listRow('IMG_9.JPG', 'done', { item: { kind: 'hash', hash: MD5, path: 'private/var/tmp/kopia/IMG_9.JPG' }, summary: { filename: 'IMG_9.JPG', factors: {} } });
    assert.ok(B.matches(hash, { text: MD5.slice(0, 12).toUpperCase() }));
    assert.ok(B.matches(hash, { text: 'tmp/kopia' }));
});

test('förloppet: antalet klara, och tiden som är kvar först när det finns något att räkna på', () => {
    assert.strictEqual(B.progressText(0, 200, 0), '0 av 200 klara');
    assert.strictEqual(B.progressText(2, 200, 60000), '2 av 200 klara', 'två filer är för få');
    assert.strictEqual(B.progressText(50, 200, 1500), '50 av 200 klara', 'under två sekunder');
    assert.strictEqual(B.progressText(37, 200, 9000), '37 av 200 klara · ungefär 40 s kvar');
    assert.strictEqual(B.progressText(100, 200, 60000), '100 av 200 klara · ungefär 60 s kvar');
    assert.strictEqual(B.progressText(100, 1000, 30000), '100 av 1000 klara · ungefär 5 min kvar');
    assert.strictEqual(B.progressText(190, 200, 40000), '190 av 200 klara · några sekunder kvar');
    assert.strictEqual(B.progressText(200, 200, 40000), '200 av 200 klara');
    assert.strictEqual(B.progressText(5, 10), '5 av 10 klara', 'utan tid');
});

test('förloppet: tiden som är kvar räknas på de senaste filernas takt när den är känd', () => {
    // Den första filen läser in databaserna. Räknat på alla tre filerna vore det över tre timmar kvar.
    assert.strictEqual(B.progressText(3, 3000, 12000), '3 av 3000 klara · ungefär 200 min kvar');
    assert.strictEqual(B.progressText(3, 3000, 12000, 50), '3 av 3000 klara · ungefär 2 min kvar');
    assert.strictEqual(B.progressText(2900, 3000, 400000, 50), '2900 av 3000 klara · några sekunder kvar');
    assert.strictEqual(B.progressText(100, 200, 60000, 0), '100 av 200 klara · ungefär 60 s kvar', 'utan takt räknas på alla filer');
});

test('en rad per träff: valet läggs på en kopia av posten, med träffens nummer', () => {
    const item = { kind: 'name', name: 'IMG_3.JPG' };
    assert.deepStrictEqual(B.hitItems(item, [{ pk: 4 }, { pk: 9 }]), [
        { kind: 'name', name: 'IMG_3.JPG', pk: 4, hit: { n: 1, of: 2 } },
        { kind: 'name', name: 'IMG_3.JPG', pk: 9, hit: { n: 2, of: 2 } },
    ]);
    assert.deepStrictEqual(item, { kind: 'name', name: 'IMG_3.JPG' }, 'posten som delades ändras inte');
    assert.deepStrictEqual(B.hitItems({ kind: 'hash', hash: MD5 }, [{ path: 'a/x.jpg' }, { path: 'b/x.jpg' }, { path: 'c/x.jpg' }]).map((i) => i.path + ' ' + i.hit.n + '/' + i.hit.of), ['a/x.jpg 1/3', 'b/x.jpg 2/3', 'c/x.jpg 3/3']);
    assert.deepStrictEqual(B.hitItems(item, []), []);
    assert.deepStrictEqual(B.hitItems(item, null), []);
});
