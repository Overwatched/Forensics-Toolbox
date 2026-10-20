const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const media = require('../../electron/media-protocol.js');

function seconds(date) {
    return Math.floor(date.getTime() / 1000);
}

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

function sameTimes(file, before) {
    const after = fs.statSync(file);
    assert.strictEqual(seconds(after.mtime), seconds(before.mtime), 'mtime');
    assert.strictEqual(seconds(after.atime), seconds(before.atime), 'atime');
    assert.strictEqual(after.size, before.size);
}

test('läsning med O_NOATIME lämnar tidsstämplarna', async () => {
    await withFile('bild.jpg', Buffer.from('bildinnehall'), async (file) => {
        const before = fs.statSync(file);
        const body = await media.readPreservingTimes(file, 0, before.size);
        assert.strictEqual(body.toString(), 'bildinnehall');
        await media.readPreservingTimes(file, 4, 3);
        sameTimes(file, before);
    });
});

test('läsning som måste ställa tillbaka tiden lämnar tidsstämplarna', async () => {
    await withFile('film.mp4', Buffer.from('0123456789'), async (file) => {
        const before = fs.statSync(file);
        const body = await media.readPreservingTimes(file, 2, 4, { noatime: false });
        assert.strictEqual(body.toString(), '2345');
        sameTimes(file, before);
    });
});

test('bara en tillåten bild eller video lämnas ut, och tiden står kvar', async () => {
    await withFile('bevis.jpg', Buffer.from('hemlig-bild'), async (file) => {
        const before = fs.statSync(file);
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
