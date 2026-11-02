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
