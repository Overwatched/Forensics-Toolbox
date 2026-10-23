const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const media = require('../../electron/media-protocol.js');

async function withFile(name, bytes, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-media-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    const past = new Date('2019-05-04T06:07:08Z');
    fs.utimesSync(file, past, past);
    try {
        await fn(file);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Läsningen får aldrig skriva till filen. mtime och ctime jämförs på nanosekunden:
// en utimes() efter läsningen skulle tappa nanosekunder och flytta ctime.
// atime jämförs bara där O_NOATIME finns (Linux).
function stat(file) {
    return fs.statSync(file, { bigint: true });
}

function sameTimes(file, before) {
    const after = stat(file);
    assert.strictEqual(after.mtimeNs, before.mtimeNs, 'mtime');
    assert.strictEqual(after.ctimeNs, before.ctimeNs, 'ctime');
    if (fs.constants.O_NOATIME) assert.strictEqual(after.atimeNs, before.atimeNs, 'atime');
    assert.strictEqual(after.size, before.size);
}

test('läsning skriver inte till filen', async () => {
    await withFile('bild.jpg', Buffer.from('bildinnehall'), async (file) => {
        const before = stat(file);
        const body = await media.readRange(file, 0, Number(before.size));
        assert.strictEqual(body.toString(), 'bildinnehall');
        await media.readRange(file, 4, 3);
        sameTimes(file, before);
    });
});

test('läsning utan O_NOATIME skriver inte heller till filen', async () => {
    await withFile('film.mp4', Buffer.from('0123456789'), async (file) => {
        const before = stat(file);
        const body = await media.readRange(file, 2, 4, { noatime: false });
        assert.strictEqual(body.toString(), '2345');
        const after = stat(file);
        assert.strictEqual(after.mtimeNs, before.mtimeNs, 'mtime');
        assert.strictEqual(after.ctimeNs, before.ctimeNs, 'ctime');
    });
});

test('läsning på en skrivskyddad fil fungerar', async () => {
    await withFile('skyddad.jpg', Buffer.from('skrivskydd'), async (file) => {
        fs.chmodSync(file, 0o444);
        const before = stat(file);
        const body = await media.readRange(file, 0, 10, { noatime: false });
        assert.strictEqual(body.toString(), 'skrivskydd');
        sameTimes(file, before);
        fs.chmodSync(file, 0o644);
    });
});

test('bara en tillåten bild eller video lämnas ut, och tiden står kvar', async () => {
    await withFile('bevis.jpg', Buffer.from('hemlig-bild'), async (file) => {
        const before = stat(file);
        const url = 'ftmedia://view/?p=' + encodeURIComponent(file);
        const blocked = await media.mediaRequestHandler(new Request(url));
        assert.strictEqual(blocked.status, 403);
        assert.strictEqual(await media.allow(file), true);
        const full = await media.mediaRequestHandler(new Request(url));
        assert.strictEqual(full.status, 200);
        assert.strictEqual(full.headers.get('Content-Type'), 'image/jpeg');
        assert.strictEqual(Buffer.from(await full.arrayBuffer()).toString(), 'hemlig-bild');
        const part = await media.mediaRequestHandler(new Request(url, { headers: { Range: 'bytes=0-5' } }));
        assert.strictEqual(part.status, 206);
        assert.strictEqual(Buffer.from(await part.arrayBuffer()).toString(), 'hemlig');
        sameTimes(file, before);
        assert.strictEqual(await media.allow(path.dirname(file)), false);
        await media.revoke(file);
        const again = await media.mediaRequestHandler(new Request(url));
        assert.strictEqual(again.status, 403);
    });
});
