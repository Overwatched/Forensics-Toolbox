// Delningen av inlästa databaser mellan verktygen: huvudfönstrets bokföring och verktygens del, med meddelandena
// emellan som i webbläsaren (fixtures/share-world.js). Hur en databas läses genom delningen testas i
// tools/db-queries/extraction-share.test.js.

const test = require('node:test');
const assert = require('node:assert');
const share = require('./db-share');
const { world, looseRefs } = require('./fixtures/share-world');

function image(size, fill) {
    const bytes = new Uint8Array(size || 4096).fill(fill === undefined ? 7 : fill);
    bytes.set(Buffer.from('SQLite format 3\u0000', 'latin1'));
    return bytes;
}

const FILE = { name: 'Testextraktion_fs.zip', size: 123456, lastModified: 1717245296000 };
const DB = { name: 'private/var/mobile/grdb/signal.sqlite', localOffset: 4000, size: 8192, crc32: 0x1234abcd };
const WAL = { name: 'private/var/mobile/grdb/signal.sqlite-wal', localOffset: 13000, size: 4152, crc32: 0x0badcafe };

test('keyOf: samma fil, poster och dekryptering ger samma nyckel, och varje skillnad en annan', () => {
    const key = share.keyOf(FILE, DB, WAL, 'signal-ios:ab12');
    assert.strictEqual(key, share.keyOf(Object.assign({}, FILE), Object.assign({}, DB), Object.assign({}, WAL), 'signal-ios:ab12'));
    const others = [
        share.keyOf(Object.assign({}, FILE, { size: 123457 }), DB, WAL, 'signal-ios:ab12'),
        share.keyOf(Object.assign({}, FILE, { lastModified: 1717245296001 }), DB, WAL, 'signal-ios:ab12'),
        share.keyOf(Object.assign({}, FILE, { name: 'Annan_fs.zip' }), DB, WAL, 'signal-ios:ab12'),
        share.keyOf(FILE, Object.assign({}, DB, { localOffset: 4001 }), WAL, 'signal-ios:ab12'),
        share.keyOf(FILE, Object.assign({}, DB, { crc32: 1 }), WAL, 'signal-ios:ab12'),
        share.keyOf(FILE, DB, null, 'signal-ios:ab12'),
        share.keyOf(FILE, DB, Object.assign({}, WAL, { size: 1 }), 'signal-ios:ab12'),
        share.keyOf(FILE, DB, WAL, 'signal-ios:cd34'),
        share.keyOf(FILE, DB, WAL, ''),
    ];
    assert.strictEqual(new Set(others.concat([key])).size, others.length + 1);
    assert.strictEqual(share.keyOf(null, DB, WAL, ''), '');
    assert.strictEqual(share.keyOf(FILE, null, null, ''), '');
});

test('den första läser själv, och nästa får en kopia med uppgifterna om läsningen', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const first = a.client.want('k');
    await w.settle();
    assert.strictEqual(await first, null, 'ingen har den: läs själv');
    const mine = image(4096, 9);
    a.client.have('k', mine, { hashes: { db: 'ab', wal: '' }, readAt: 1700000000000 });
    await w.settle();

    const waits = [];
    const second = b.client.want('k', (x) => waits.push(x));
    await w.settle();
    const got = await second;
    assert.deepStrictEqual(Buffer.from(got.bytes), Buffer.from(mine));
    assert.notStrictEqual(got.bytes.buffer, mine.buffer, 'en egen kopia');
    assert.strictEqual(mine.length, 4096, 'den som gav har sin kvar');
    assert.deepStrictEqual(got.hashes, { db: 'ab', wal: '' });
    assert.strictEqual(got.readAt, 1700000000000);
    assert.strictEqual(got.readBy, 'Chattar');
    assert.deepStrictEqual(waits.map((x) => [x.by, x.why]), [['Chattar', 'copy']]);
    assert.strictEqual(w.clock.pending(), 0, 'inga klockor kvar');
});

test('kopian går vidare med den som först läste den, också när det verktyget har stängt', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const c = w.tool('Queries');
    const first = a.client.want('k');
    await w.settle();
    await first;
    a.client.have('k', image(), { readAt: 5 });
    const second = b.client.want('k');
    await w.settle();
    const got = await second;
    b.client.have('k', got.bytes, { readAt: got.readAt, readBy: got.readBy });
    a.client.gone();
    await w.settle();
    const third = c.client.want('k');
    await w.settle();
    const last = await third;
    assert.strictEqual(last.readBy, 'Chattar');
    assert.strictEqual(last.readAt, 5);
    assert.deepStrictEqual(Buffer.from(last.bytes), Buffer.from(image()));
    assert.ok(!a.got.includes('db-give') || a.got.filter((t) => t === 'db-give').length === 1, 'den som stängt får ingen fråga till');
});

test('den som frågar medan ett annat verktyg läser in väntar på det, och ser hur långt det har kommit', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const first = a.client.want('k');
    await w.settle();
    assert.strictEqual(await first, null);

    const waits = [];
    let done = false;
    const second = b.client.want('k', (x) => waits.push(x));
    second.then(() => { done = true; });
    await w.settle();
    a.client.progress('k', 'decrypt', 0.5);
    await w.settle();
    w.clock.advance(10 * share.ACK_MS);
    await w.settle();
    assert.strictEqual(done, false, 'väntan på den som läser har ingen gräns');
    assert.deepStrictEqual(waits, [{ by: 'Chattar', why: 'load', stage: null, frac: null }, { by: 'Chattar', why: 'load', stage: 'decrypt', frac: 0.5 }]);

    a.client.have('k', image(8192, 3), { readAt: 1 });
    await w.settle();
    const got = await second;
    assert.deepStrictEqual(Buffer.from(got.bytes), Buffer.from(image(8192, 3)));
    assert.strictEqual(got.readBy, 'Chattar');
    assert.deepStrictEqual(waits[waits.length - 1], { by: 'Chattar', why: 'copy', stage: null, frac: null });
    assert.deepStrictEqual(b.sent, ['db-want'], 'en fråga räckte');
});

test('när inläsningen misslyckas läser den första som väntar själv, och de andra väntar på den', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const c = w.tool('Queries');
    const first = a.client.want('k');
    await w.settle();
    await first;
    const second = b.client.want('k');
    await w.settle();
    const waits = [];
    let third = null;
    c.client.want('k', (x) => waits.push(x)).then((x) => { third = x; });
    await w.settle();

    a.client.failed('k');
    await w.settle();
    assert.strictEqual(await second, null, 'Härkomst läser nu själv');
    assert.strictEqual(third, null);
    assert.deepStrictEqual(waits.map((x) => x.by), ['Chattar', 'Härkomst']);

    b.client.have('k', image(4096, 4), {});
    await w.settle();
    assert.deepStrictEqual(Buffer.from(third.bytes), Buffer.from(image(4096, 4)));
    assert.strictEqual(third.readBy, 'Härkomst');
});

test('en avbild som är för liten att dela: den som väntade läser själv, och ingen väntar på den efteråt', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const c = w.tool('Queries');
    const first = a.client.want('k');
    await w.settle();
    assert.strictEqual(await first, null);
    let second = 'väntar';
    b.client.want('k').then((x) => { second = x; });
    await w.settle();
    assert.strictEqual(second, 'väntar');

    // En tom databas, eller en fil utan ett helt SQLite-huvud, har ingenting att dela.
    a.client.have('k', new Uint8Array(64), {});
    await w.settle();
    assert.strictEqual(second, null, 'Härkomst läser själv');
    assert.deepStrictEqual(a.sent, ['db-want', 'db-failed']);
    assert.strictEqual(a.client.holds('k'), false);
    b.client.have('k', new Uint8Array(0), {});
    await w.settle();
    assert.strictEqual(await w.until(c.client.want('k')), null, 'och Queries väntar inte på någon');
    c.client.have('k', null, {});
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 0, gives: 0 });
    assert.strictEqual(w.clock.pending(), 0);
});

test('ett verktyg som inte går att nå räknas inte som den som läser in', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.refuses = (m) => m.type === 'db-result';
    a.client.want('k');
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 0, gives: 0 });
    assert.strictEqual(await w.until(b.client.want('k')), null, 'Härkomst läser själv, utan att vänta');
});

test('en stängd databas lämnas inte ut: frågaren läser själv, och verktyget tillfrågas inte igen', async () => {
    const w = world();
    const refs = looseRefs();
    const a = w.tool('Chattar', { WeakRef: refs.WeakRef });
    const b = w.tool('Härkomst');
    const c = w.tool('Queries');
    a.client.have('k', image(), {});
    await w.settle();
    refs.drop();
    const second = b.client.want('k');
    await w.settle();
    assert.strictEqual(await second, null);
    assert.strictEqual(a.client.holds('k'), false);
    b.client.failed('k');
    const third = c.client.want('k');
    await w.settle();
    assert.strictEqual(await third, null);
    assert.strictEqual(a.got.filter((t) => t === 'db-give').length, 1);
});

test('en avbild som något har skrivit i lämnas inte ut', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const mine = image();
    a.client.have('k', mine, {});
    await w.settle();
    mine[27]++;         // filens ändringsräknare, som SQLite räknar upp vid varje skrivning
    const second = b.client.want('k');
    await w.settle();
    assert.strictEqual(await second, null);
    assert.strictEqual(a.client.holds('k'), false);
});

test('nästa verktyg som har databasen tillfrågas när det första inte har den kvar', async () => {
    const w = world();
    const refs = looseRefs();
    const a = w.tool('Chattar', { WeakRef: refs.WeakRef });
    const b = w.tool('Härkomst');
    const c = w.tool('Queries');
    a.client.have('k', image(4096, 1), {});
    b.client.have('k', image(4096, 1), { readBy: 'Chattar' });
    await w.settle();
    refs.drop();
    const third = c.client.want('k');
    await w.settle();
    const got = await third;
    assert.deepStrictEqual(Buffer.from(got.bytes), Buffer.from(image(4096, 1)));
    assert.strictEqual(got.readBy, 'Chattar');
});

test('utan huvudfönster läser verktyget själv, utan att fråga', async () => {
    const w = world();
    const a = w.tool('Chattar');
    a.online = false;
    assert.strictEqual(await a.client.want('k'), null);
    a.client.have('k', image(), {});
    a.client.failed('k');
    a.client.gone();
    assert.deepStrictEqual(a.sent, []);
    assert.strictEqual(await a.client.want(''), null);
});

test('utan svaga referenser hålls ingenting kvar och ingenting delas', async () => {
    const w = world();
    const a = w.tool('Chattar', { WeakRef: null });
    assert.strictEqual(await a.client.want('k'), null);
    a.client.have('k', image(), {});
    assert.strictEqual(a.client.holds('k'), false);
    assert.deepStrictEqual(a.sent, []);
});

test('ett huvudfönster som inte svarar: verktyget läser själv efter en stund, och ett sent svar gör ingenting', async () => {
    const w = world();
    const a = w.tool('Chattar');
    a.deaf = true;
    let got = 'väntar';
    a.client.want('k').then((x) => { got = x; });
    await w.settle();
    w.clock.advance(share.ACK_MS - 1);
    await w.settle();
    assert.strictEqual(got, 'väntar');
    w.clock.advance(1);
    await w.settle();
    assert.strictEqual(got, 'väntar', 'ett svar i kön får en vända till på sig');
    w.clock.advance(50);
    await w.settle();
    assert.strictEqual(got, null);
    assert.deepStrictEqual(a.sent, ['db-want', 'db-unwant']);
    a.receive({ source: share.SOURCE, type: 'db-result', id: 'okänd', data: { bytes: image().buffer } });
    assert.strictEqual(w.clock.pending(), 0);
});

test('ett svar som kommer precis när väntan tar slut gäller', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.client.have('k', image(4096, 2), {});
    await w.settle();
    let got = 'väntar';
    b.client.want('k').then((x) => { got = x; });
    // Sidan har stått still: klockan har gått ut, men svaret ligger redan i kön.
    w.clock.advance(share.ACK_MS);
    await w.settle();
    assert.deepStrictEqual(Buffer.from(got.bytes), Buffer.from(image(4096, 2)));
    assert.deepStrictEqual(b.sent, ['db-want']);
});

test('ett verktyg som inte lämnar sin kopia: efter en stund läser frågaren själv', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.client.have('k', image(), {});
    await w.settle();
    a.handlers.length = 0;      // ramen svarar inte längre
    let got = 'väntar';
    b.client.want('k').then((x) => { got = x; });
    await w.settle();
    assert.strictEqual(got, 'väntar');
    w.clock.advance(share.GIVE_MS);
    await w.settle();
    assert.strictEqual(got, null);
    b.client.have('k', image(), {});
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 1, gives: 0 });
});

test('den som slutar vänta får inget svar, och den som läser märker ingenting', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const first = a.client.want('k');
    await w.settle();
    await first;
    let got = 'väntar';
    b.client.want('k').then((x) => { got = x; });
    await w.settle();
    w.reg.handle(b, { source: share.SOURCE, type: 'db-unwant', id: b.posts[0].id });
    a.client.have('k', image(), {});
    await w.settle();
    assert.strictEqual(got, 'väntar');
    assert.ok(!a.got.includes('db-give'), 'ingen kopia görs åt den som slutat vänta');
    a.client.gone('k');
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 0, gives: 0 });
});

test('den som slutar vänta på en kopia: kopian som ändå kommer kastas, och klockan stannar', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.client.have('k', image(), {});
    await w.settle();
    const answer = a.handlers.splice(0);     // ramen svarar först senare
    let got = 'väntar';
    b.client.want('k').then((x) => { got = x; });
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 1, gives: 1 });
    w.reg.handle(b, { source: share.SOURCE, type: 'db-unwant', id: b.posts[0].id });
    assert.deepStrictEqual(w.reg.state(), { keys: 1, gives: 0 });
    answer.forEach((fn) => fn({ source: share.SOURCE, type: 'db-give', id: 'give-1', key: 'k' }));
    await w.settle();
    assert.strictEqual(got, 'väntar');
    assert.deepStrictEqual(b.got, ['db-wait']);
    assert.strictEqual(a.client.holds('k'), true, 'den som gav har sin kvar');
});

test('huvudfönstret minns ingenting när alla har stängt', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    for (const key of ['k1', 'k2']) {
        const first = a.client.want(key);
        await w.settle();
        await first;
        a.client.have(key, image(), {});
        const second = b.client.want(key);
        await w.settle();
        b.client.have(key, (await second).bytes, {});
    }
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 2, gives: 0 });
    a.client.gone('k1');
    b.client.gone('k1');
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 1, gives: 0 });
    a.client.gone();
    b.client.gone();
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 0, gives: 0 });
    // Den som misslyckas utan att ha frågat lämnar inget efter sig.
    a.client.failed('k3');
    a.client.progress('k3', 'read', null);
    await w.settle();
    assert.deepStrictEqual(w.reg.state(), { keys: 0, gives: 0 });
});

test('huvudfönstret rör bara sina egna meddelanden', () => {
    const w = world();
    const a = w.tool('Chattar');
    assert.strictEqual(w.reg.handle(a, { source: share.SOURCE, type: 'extraction-info' }), false);
    assert.strictEqual(w.reg.handle(a, { source: share.SOURCE, type: 'db-okänd', key: 'k' }), false);
    assert.strictEqual(w.reg.handle(null, { source: share.SOURCE, type: 'db-have', key: 'k' }), false);
    assert.strictEqual(w.reg.handle(a, null), false);
    assert.strictEqual(w.reg.handle(a, { source: share.SOURCE, type: 'db-have', key: 'k' }), true);
});

test('samma verktyg som frågar två gånger får läsa själv båda gångerna, och håller sedan databasen en gång', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const one = a.client.want('k');
    const two = a.client.want('k');
    await w.settle();
    assert.strictEqual(await one, null);
    assert.strictEqual(await two, null);
    a.client.have('k', image(), {});
    a.client.have('k', image(), {});
    await w.settle();
    const got = b.client.want('k');
    await w.settle();
    assert.ok((await got).bytes.length);
    assert.strictEqual(a.got.filter((t) => t === 'db-give').length, 1);
});

test('uppgifter som inte går att skicka: frågaren får ändå svar, och läser själv', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.client.have('k', image(), { stats: { broken: () => 1 } });
    await w.settle();
    const second = b.client.want('k');
    await w.settle();
    assert.strictEqual(await second, null);
    assert.strictEqual(a.client.holds('k'), false);
    assert.strictEqual(w.clock.pending(), 0);
});

test('en kopia som inte går att skicka vidare: frågaren läser själv', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.client.have('k', image(), {});
    await w.settle();
    b.refuses = (m) => m.type === 'db-result' && !!m.data;
    const second = b.client.want('k');
    await w.settle();
    assert.strictEqual(await second, null);
    assert.strictEqual(w.clock.pending(), 0);
});

test('ett verktyg som laddas om mitt i en inläsning: de som väntade läser själva, och det tillfrågas inte mer', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    const c = w.tool('Queries');
    a.client.have('har', image(), {});
    const loading = a.client.want('läser');
    await w.settle();
    assert.strictEqual(await loading, null);
    const waits = [];
    const second = b.client.want('läser', (x) => waits.push(x.why));
    const third = c.client.want('läser');
    await w.settle();
    assert.deepStrictEqual(waits, ['load']);

    w.reg.forget(a);
    await w.settle();
    assert.strictEqual(await second, null, 'den första som väntade läser själv');
    b.client.have('läser', image(), {});
    await w.settle();
    assert.strictEqual((await third).readBy, 'Härkomst', 'och nästa väntade på den');

    const asked = a.got.length;
    const fourth = c.client.want('har');
    await w.settle();
    assert.strictEqual(await fourth, null);
    assert.strictEqual(a.got.length, asked, 'det omladdade verktyget tillfrågas inte');
});

test('ett verktyg som laddas om innan det har lämnat sin kopia: frågaren läser själv, utan att vänta ut klockan', async () => {
    const w = world();
    const a = w.tool('Chattar');
    const b = w.tool('Härkomst');
    a.client.have('k', image(), {});
    await w.settle();
    // Ramen laddas om: ingen lyssnar när frågan om en kopia kommer.
    a.handlers.length = 0;
    const second = b.client.want('k');
    await w.settle();
    assert.strictEqual(w.reg.state().gives, 1);
    w.reg.forget(a);
    await w.settle();
    assert.strictEqual(await second, null);
    assert.deepStrictEqual(w.reg.state().gives, 0);
    assert.strictEqual(w.clock.pending(), 0);
    // Den som frågade och själv laddas om glöms också.
    const c = w.tool('Queries');
    b.client.have('k', image(), {});
    await w.settle();
    b.handlers.length = 0;
    c.client.want('k');
    await w.settle();
    w.reg.forget(c);
    assert.strictEqual(w.reg.state().gives, 0);
    assert.strictEqual(w.clock.pending(), 0);
});
