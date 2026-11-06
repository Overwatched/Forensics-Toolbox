// Nyckelfiler bredvid extraktionen, som skrivbordsappen läser dem: riktiga filer i en tillfällig mapp.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { beside, MAX_KEY_FILE } = require('../../electron/key-files');

const UDID = '00008030-0000000000000001';

function folder(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nycklar-'));
    Object.keys(files).forEach((n) => fs.writeFileSync(path.join(dir, n), files[n]));
    return dir;
}

test('bredvid zippen: nyckelfilen med samma id läses, och inget annat i mappen', async (t) => {
    const dir = folder({ [UDID + '_fs.zip']: 'zip', [UDID + '_keychain.plist']: 'nyckel', '00008030-00000000AAAAAAAA_keychain.plist': 'annan', 'passwords.txt': 'hemligt' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const out = await beside(path.join(dir, UDID + '_fs.zip'));
    assert.deepStrictEqual(out.other, []);
    assert.deepStrictEqual(out.files.map((f) => f.name), [UDID + '_keychain.plist']);
    assert.strictEqual(Buffer.from(out.files[0].bytes).toString(), 'nyckel');
    assert.ok(out.files[0].bytes instanceof Uint8Array);
});

test('bredvid zippen: filen ändras inte av att läsas', async (t) => {
    const dir = folder({ 'EXTRACTION_FFS.zip': 'zip', 'backup_keychain_v2.plist': 'nyckel' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const at = path.join(dir, 'backup_keychain_v2.plist');
    const old = new Date('2024-06-01T12:00:00Z');
    fs.utimesSync(at, old, old);
    const before = fs.statSync(at);
    const out = await beside(path.join(dir, 'EXTRACTION_FFS.zip'));
    assert.strictEqual(out.files.length, 1);
    const after = fs.statSync(at);
    assert.strictEqual(after.mtimeMs, before.mtimeMs);
    assert.strictEqual(after.ctimeMs, before.ctimeMs);
    assert.strictEqual(after.size, before.size);
});

test('bredvid zippen: flera utan id väljs inte, utan nämns', async (t) => {
    const dir = folder({ 'EXTRACTION_FFS.zip': 'zip', 'a_keychain.plist': 'a', 'b_keychain.plist': 'b' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const out = await beside(path.join(dir, 'EXTRACTION_FFS.zip'));
    assert.deepStrictEqual(out, { files: [], other: ['a_keychain.plist', 'b_keychain.plist'] });
});

test('bredvid zippen: bara vanliga filer, inga mappar eller länkar', async (t) => {
    const dir = folder({ 'EXTRACTION_FFS.zip': 'zip' });
    const outside = folder({ 'hemlig_keychain.plist': 'utanför' });
    t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
    fs.mkdirSync(path.join(dir, 'mapp_keystore'));
    fs.symlinkSync(path.join(outside, 'hemlig_keychain.plist'), path.join(dir, 'lank_keychain.plist'));
    assert.deepStrictEqual(await beside(path.join(dir, 'EXTRACTION_FFS.zip')), { files: [], other: [] });
});

test('bredvid zippen: en fil över gränsen läses inte, och nämns', async (t) => {
    const dir = folder({ 'EXTRACTION_FFS.zip': 'zip' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const big = path.join(dir, 'stor_keychain.plist');
    fs.closeSync(fs.openSync(big, 'w'));
    fs.truncateSync(big, MAX_KEY_FILE + 1);
    assert.deepStrictEqual(await beside(path.join(dir, 'EXTRACTION_FFS.zip')), { files: [], other: ['stor_keychain.plist'] });
});

test('bredvid zippen: bara för en zip eller rapport, och en mapp som inte finns är inget fel', async () => {
    assert.strictEqual(await beside('/etc/passwd'), null);
    assert.strictEqual(await beside(''), null);
    assert.strictEqual(await beside(null), null);
    assert.strictEqual(await beside(path.join(os.tmpdir(), 'finns-inte-' + process.pid, 'a.zip')), null);
});
