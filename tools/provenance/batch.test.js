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
