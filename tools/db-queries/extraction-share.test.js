// Verktygen delar på läsningen av en databas (tools/_shared/db-share.js): det andra verktyget som behöver samma
// databas får en kopia av det förstas avbild med uppgifterna om läsningen, väntar om det första håller på, och
// läser själv när det inte går att dela. Verktygen är här två klienter i samma process, med ett huvudfönster emellan.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { buildZip, reader } = require('./fixtures/zip-builder');
const { buildUfdr } = require('./fixtures/ufdr-builder');
const { sqlJs, makeDb, encryptDb, makeDbIos, encryptDbIos } = require('./fixtures/sqlcipher-builder');
const E = require('./fixtures/postbox-encode');
const { world, looseRefs } = require('../_shared/fixtures/share-world');
const share = require('../_shared/db-share');
const core = require('./extraction-core');
const sc = require('./sqlcipher');
const PB = require('./postbox');

core.use({ ZipRead: require('./zip'), ZipLocate: require('./locate'), SqliteWal: require('./wal'), ToolboxHashing: require('../hash-calculator/hashing'), SqlCipher: sc, DbShare: share, UfdrRead: require('./ufdr') });
require('./ufdr').use({ ZipRead: require('./zip') });

const PASS = 'a3f00d9478eb7753e39c5a41a670c93e0de07a916fc97f3a79fed11daa0ecc5a';
const PATH = 'data/data/org.thoughtcrime.securesms/databases/signal.db';
const TARGETS = core.targets([{ id: 'signal', family: 'signal', label: 'Signal', paths: [PATH], ios: null }]);
const FILE = { name: 'extraktion.zip', size: 123456, lastModified: 1793000000000 };
const LEAD = ['Extraktion: extraktion.zip'];

// En läsare som räknar, så att det syns vem som läste ur zippen.
function counting(buf) {
    const read = reader(buf);
    const out = async (offset, length) => { out.calls++; return read(offset, length); };
    out.calls = 0;
    return out;
}

// En zip med databasen, och träffen som verktygen läser den med.
async function zipWith(db) {
    const buf = buildZip([{ name: 'filesystem1/' + PATH, data: Buffer.from(db), mtime: 1793000000 }]);
    const opened = await core.open(reader(buf), buf.length, TARGETS);
    return { buf, hit: opened.found[0] };
}

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sharing = (frame, more) => Object.assign({ share: { file: FILE, client: frame.client } }, more);

function rowsOf(SQL, bytes, sql) {
    const db = new SQL.Database(bytes.slice());
    try { return db.exec(sql)[0].values; }
    finally { db.close(); }
}

test('det andra verktyget får en kopia med samma uppgifter, utan att läsa ur zippen', async () => {
    const SQL = await sqlJs();
    const { buf, hit } = await zipWith(await makeDb(40));
    const w = world();
    const a = w.tool('Chattar'), b = w.tool('Härkomst');
    const readA = counting(buf), readB = counting(buf);

    const first = await w.until(core.loadDatabase(readA, hit, LEAD, sharing(a)));
    assert.ok(readA.calls > 0);
    assert.strictEqual(first.sharedBy, '');
    assert.strictEqual(first.sharedLine, '');
    assert.strictEqual(first.hashes.db, sha(buf.subarray(buf.indexOf('SQLite format 3'), buf.indexOf('SQLite format 3') + hit.db.size)));

    const stages = [];
    const second = await w.until(core.loadDatabase(readB, hit, LEAD, sharing(b, { onStage: (stage, frac, by) => stages.push([stage, by]) })));
    assert.strictEqual(readB.calls, 0, 'inget lästes ur zippen');
    assert.deepStrictEqual(stages, [['copy', 'Chattar']]);
    assert.strictEqual(second.sharedBy, 'Chattar');
    assert.deepStrictEqual(second.hashes, first.hashes);
    assert.deepStrictEqual(second.stats, first.stats);
    assert.deepStrictEqual(second.warnings, first.warnings);
    assert.strictEqual(second.crcOk, true);
    assert.ok(Buffer.from(second.bytes).equals(Buffer.from(first.bytes)), 'samma avbild');
    assert.notStrictEqual(second.bytes.buffer, first.bytes.buffer, 'i eget minne');
    // Protokollet har samma rader, och en till som säger vem som läste och när.
    assert.deepStrictEqual(second.lines.slice(0, -1), first.lines);
    assert.match(second.lines[second.lines.length - 1], /^Läst ur zippen av Chattar \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Verktygen delar på läsningen: här används en kopia av avbilden i minnet, och CRC32 och SHA-256 ovan är från den läsningen\.$/);
    assert.strictEqual(second.sharedLine, second.lines[second.lines.length - 1]);
    assert.strictEqual(rowsOf(SQL, second.bytes, 'SELECT count(*) FROM message')[0][0], 40);
});

test('en dekrypterad databas delas med verktyget som har samma nyckel, och det dekrypterar inte igen', async () => {
    const SQL = await sqlJs();
    const plain = await makeDb(40);
    const { buf, hit } = await zipWith(encryptDb(plain, PASS, crypto.randomBytes(16)).bytes);
    const w = world();
    const a = w.tool('Chattar'), b = w.tool('Härkomst');
    const readA = counting(buf), readB = counting(buf);
    let decryptedA = 0, decryptedB = 0;

    const first = await w.until(core.loadDatabase(readA, hit, LEAD, sharing(a, { cipher: { profile: 'signal', passphrase: PASS, source: 'secrets.json i zippen' }, onProgress: () => { decryptedA++; } })));
    assert.ok(decryptedA > 0);
    assert.ok(Buffer.from(first.bytes).equals(Buffer.from(plain)));

    // Samma nyckel, som det här verktyget fick någon annanstans ifrån.
    const second = await w.until(core.loadDatabase(readB, hit, LEAD, sharing(b, { cipher: { profile: 'signal', passphrase: PASS, source: 'inklistrad' }, onProgress: () => { decryptedB++; } })));
    assert.strictEqual(readB.calls, 0);
    assert.strictEqual(decryptedB, 0);
    assert.ok(Buffer.from(second.bytes).equals(Buffer.from(plain)));
    assert.deepStrictEqual(second.stats.cipher, first.stats.cipher);
    assert.match(first.cipherLine, /^Dekrypterad i minnet .* med nyckeln ur secrets\.json i zippen: \d+ sidor\. Kontrollsumman \(HMAC\) stämde för alla sidor\.$/);
    assert.match(second.cipherLine, /med den inklistrade nyckeln/, 'nyckelns källa är verktygets egen');
    assert.match(second.sharedLine, /^Läst ur zippen av Chattar .* och CRC32, SHA-256 och dekrypteringen ovan är från den läsningen\.$/);
    assert.strictEqual(rowsOf(SQL, second.bytes, 'SELECT count(*) FROM message')[0][0], 40);
});

test('utan nyckeln, eller med en annan, får verktyget aldrig ett annat verktygs dekryptering', async () => {
    const plain = await makeDb(12);
    const { buf, hit } = await zipWith(encryptDb(plain, PASS, crypto.randomBytes(16)).bytes);
    const w = world();
    const a = w.tool('Chattar');
    await w.until(core.loadDatabase(counting(buf), hit, LEAD, sharing(a, { cipher: { profile: 'signal', passphrase: PASS, source: 'x' } })));

    // Verktyget vet att databasen är krypterad men har ingen nyckel.
    const readB = counting(buf);
    await assert.rejects(w.until(core.loadDatabase(readB, hit, LEAD, sharing(w.tool('Härkomst'), { cipher: { profile: 'signal', passphrase: null, hint: 'secrets.json' } }))),
        (err) => err.code === 'ENCRYPTED' && /är krypterad \(SQLCipher\), och ingen nyckel hittades: extraktionen saknar secrets\.json/.test(err.message));
    assert.ok(readB.calls > 0, 'läste själv');

    // Fel nyckel: läser själv, och får felet om nyckeln.
    const readC = counting(buf);
    await assert.rejects(w.until(core.loadDatabase(readC, hit, LEAD, sharing(w.tool('Queries'), { cipher: { profile: 'signal', passphrase: PASS.replace(/^a/, 'b'), source: 'y' } }))), /Nyckeln passar inte/);
    assert.ok(readC.calls > 0, 'läste själv');

    // Verktyget vet inget om kryptering: det får filen som den är, och den delas inte vidare.
    const d = w.tool('Queries');
    const readD = counting(buf), readE = counting(buf);
    const raw = await w.until(core.loadDatabase(readD, hit, LEAD, sharing(d)));
    assert.ok(readD.calls > 0 && sc.isEncrypted(raw.bytes));
    const again = await w.until(core.loadDatabase(readE, hit, LEAD, sharing(w.tool('Härkomst'))));
    assert.ok(readE.calls > 0, 'en krypterad avbild lämnas inte ut');
    assert.strictEqual(again.sharedBy, '');
});

test('Signal på iOS: profilen hör till nyckeln, och samma nyckel ger en kopia', async () => {
    const plain = await makeDbIos(20);
    const raw = crypto.randomBytes(48);
    const { buf, hit } = await zipWith(encryptDbIos(plain, raw).bytes);
    const w = world();
    const cipher = { profile: 'signal-ios', passphrase: "x'" + raw.toString('hex') + "'", source: 'nyckelringen' };
    const first = await w.until(core.loadDatabase(counting(buf), hit, LEAD, sharing(w.tool('Chattar'), { cipher })));
    const readB = counting(buf);
    const second = await w.until(core.loadDatabase(readB, hit, LEAD, sharing(w.tool('Härkomst'), { cipher })));
    assert.strictEqual(readB.calls, 0);
    assert.ok(Buffer.from(second.bytes).equals(Buffer.from(first.bytes)) && Buffer.from(second.bytes).equals(Buffer.from(plain)));
    // Samma nyckel skriven på ett annat sätt är en annan fråga: verktyget läser då själv, med samma resultat.
    const readC = counting(buf);
    const third = await w.until(core.loadDatabase(readC, hit, LEAD, sharing(w.tool('Queries'), { cipher: Object.assign({}, cipher, { passphrase: raw.toString('hex') }) })));
    assert.ok(readC.calls > 0);
    assert.ok(Buffer.from(third.bytes).equals(Buffer.from(plain)));
});

test('två verktyg samtidigt: det andra väntar på det första, ser vad det gör och läser inte ur zippen', async () => {
    const plain = await makeDb(40);
    const { buf, hit } = await zipWith(encryptDb(plain, PASS, crypto.randomBytes(16)).bytes);
    const w = world();
    const a = w.tool('Chattar'), b = w.tool('Härkomst');
    const cipher = { profile: 'signal', passphrase: PASS, source: 'x' };
    // Det första verktygets läsning står och väntar tills testet släpper den.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const readA = counting(buf), readB = counting(buf);
    const slow = async (offset, length) => { await gate; return readA(offset, length); };

    const pa = core.loadDatabase(slow, hit, LEAD, sharing(a, { cipher }));
    await w.settle();
    const texts = [];
    const pb = core.loadDatabase(readB, hit, LEAD, sharing(b, { cipher, onStage: (stage, frac, by, inner) => texts.push(core.stageText(stage, frac, by, 'Signal (signal.db)', inner)) }));
    await w.settle();
    assert.deepStrictEqual(texts, ['Väntar på Signal (signal.db), som Chattar redan läser in…']);
    release();
    const [first, second] = await w.until(Promise.all([pa, pb]));
    assert.strictEqual(readB.calls, 0);
    assert.ok(texts.some((t) => /^Väntar på Signal \(signal\.db\), som Chattar redan läser in \(räknar SHA-256…\)$/.test(t)), texts.join(' | '));
    assert.ok(texts.some((t) => /^Väntar på Signal \(signal\.db\), som Chattar redan läser in \(dekrypterar… \d+ %\)$/.test(t)), texts.join(' | '));
    assert.strictEqual(texts[texts.length - 1], 'Hämtar Signal (signal.db) från Chattar, som redan har läst den…');
    assert.ok(Buffer.from(second.bytes).equals(Buffer.from(first.bytes)));
    assert.strictEqual(second.sharedBy, 'Chattar');
});

test('läsningen misslyckas i det första verktyget: det som väntade läser själv', async () => {
    const { buf, hit } = await zipWith(await makeDb(12));
    const w = world();
    const a = w.tool('Chattar'), b = w.tool('Härkomst');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const broken = async () => { await gate; throw new Error('läsfel på disken'); };
    const readB = counting(buf);

    const pa = core.loadDatabase(broken, hit, LEAD, sharing(a));
    pa.catch(() => {});
    await w.settle();
    const pb = core.loadDatabase(readB, hit, LEAD, sharing(b));
    await w.settle();
    assert.strictEqual(readB.calls, 0, 'väntar');
    release();
    await assert.rejects(w.until(pa), /läsfel på disken/);
    const second = await w.until(pb);
    assert.ok(readB.calls > 0);
    assert.strictEqual(second.sharedBy, '');
    // Och nu har det andra verktyget databasen, så det första får en kopia därifrån.
    const readA = counting(buf);
    const retry = await w.until(core.loadDatabase(readA, hit, LEAD, sharing(a)));
    assert.strictEqual(readA.calls, 0);
    assert.strictEqual(retry.sharedBy, 'Härkomst');
});

test('en tom eller avhuggen databas har ingenting att dela: nästa verktyg läser själv, och väntar inte på den', async () => {
    for (const size of [0, 64]) {
        const data = Buffer.alloc(size);
        if (size) data.write('SQLite format 3', 'latin1');
        const { buf, hit } = await zipWith(data);
        const w = world();
        const a = w.tool('Chattar'), b = w.tool('Härkomst');
        // Det andra verktyget frågar medan det första läser, och det tredje när båda är klara.
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const readA = counting(buf), readB = counting(buf), readC = counting(buf);
        const pa = core.loadDatabase(async (offset, length) => { await gate; return readA(offset, length); }, hit, LEAD, sharing(a));
        await w.settle();
        const pb = core.loadDatabase(readB, hit, LEAD, sharing(b));
        await w.settle();
        assert.strictEqual(readB.calls, 0, 'väntar på det första');
        release();
        const [first, second] = await w.until(Promise.all([pa, pb]));
        assert.strictEqual(first.bytes.length, size);
        assert.ok(readB.calls > 0, 'läste själv');
        assert.strictEqual(second.sharedBy, '');
        const third = await w.until(core.loadDatabase(readC, hit, LEAD, sharing(w.tool('Queries'))));
        assert.ok(readC.calls > 0, 'ingen att vänta på, och ingen kopia att få');
        assert.strictEqual(third.sharedBy, '');
        assert.deepStrictEqual(w.reg.state(), { keys: 0, gives: 0 });
    }
});

test('en avbild som inte går att läsa här används inte: verktyget läser själv', async () => {
    const { buf, hit } = await zipWith(await makeDb(12));
    const key = share.keyOf(FILE, hit.db, hit.wal, '');
    const facts = { stats: {}, hashes: { db: 'x', wal: '' }, dbCrcOk: true, walCrcOk: null, encrypted: false, readAt: 1, readBy: '' };
    const good = (await core.loadDatabase(reader(buf), hit, LEAD)).bytes;
    const cases = [
        [new Uint8Array(8192).fill(7), facts],                 // inte en SQLite-fil
        [good.slice(), {}],                                    // utan uppgifterna om läsningen
        [good.slice(0, 64), facts],                            // avhuggen
    ];
    for (const [bytes, said] of cases) {
        const w = world();
        const other = w.tool('Queries');
        other.client.have(key, bytes, said);
        await w.settle();
        const readB = counting(buf);
        const got = await w.until(core.loadDatabase(readB, hit, LEAD, sharing(w.tool('Härkomst'))));
        assert.ok(readB.calls > 0);
        assert.strictEqual(got.sharedBy, '');
        assert.ok(Buffer.from(got.bytes).equals(Buffer.from(good)));
    }
});

test('i sql.js: en avbild som bara läses delas oförändrad, också med Telegrams tabeller i minnet', async () => {
    const SQL = await sqlJs();
    const KIM = E.peer(0, 7000000002);
    const postbox = E.postboxDb(SQL, {
        messages: [{ peer: KIM, timestamp: 1793000000, id: 1, author: E.peer(0, 9000000001), text: 'Hej' }],
        peers: [{ peer: KIM, value: E.user({ id: 7000000002, fn: 'Kim' }) }],
    });
    const { buf, hit } = await zipWith(postbox);
    const w = world();
    const a = w.tool('Chattar'), b = w.tool('Härkomst');
    const first = await w.until(core.loadDatabase(counting(buf), hit, LEAD, sharing(a)));
    const before = sha(first.bytes);

    // Som verktygen öppnar den: utan kopia, med Telegrams tabeller, och sedan bara läsning.
    const db = new SQL.Database(core.noCopy(first.bytes));
    assert.deepStrictEqual(PB.attach(db).tables, ['tg_message', 'tg_resource', 'tg_peer']);
    db.run('PRAGMA query_only = ON');
    assert.strictEqual(db.exec('SELECT text FROM tg_message')[0].values[0][0], 'Hej');
    assert.throws(() => db.run('CREATE TABLE egen (a)'), /readonly/);
    assert.strictEqual(sha(first.bytes), before, 'avbilden är orörd');

    const readB = counting(buf);
    const second = await w.until(core.loadDatabase(readB, hit, LEAD, sharing(b)));
    assert.strictEqual(readB.calls, 0);
    assert.strictEqual(sha(second.bytes), before);
    db.close();
});

test('i sql.js: en avbild som något har skrivit i lämnas inte ut, och nästa verktyg läser ur zippen', async () => {
    const SQL = await sqlJs();
    const { buf, hit } = await zipWith(await makeDb(12));
    const w = world();
    const a = w.tool('Queries'), b = w.tool('Härkomst');
    const first = await w.until(core.loadDatabase(counting(buf), hit, LEAD, sharing(a)));
    const before = sha(first.bytes);
    const db = new SQL.Database(core.noCopy(first.bytes));
    db.run('CREATE TABLE egen (a)');
    db.run('INSERT INTO egen VALUES (1)');

    const readB = counting(buf);
    const second = await w.until(core.loadDatabase(readB, hit, LEAD, sharing(b)));
    assert.ok(readB.calls > 0, 'läste själv');
    assert.strictEqual(second.sharedBy, '');
    assert.strictEqual(sha(second.bytes), before, 'som den står i zippen');
    assert.strictEqual(rowsOf(SQL, second.bytes, "SELECT count(*) FROM sqlite_master WHERE name = 'egen'")[0][0], 0);
    db.close();
});

test('kopian går vidare med namnet på verktyget som läste ur zippen', async () => {
    const { buf, hit } = await zipWith(await makeDb(12));
    const w = world();
    const loose = looseRefs();
    const a = w.tool('Chattar', { WeakRef: loose.WeakRef }), b = w.tool('Härkomst'), c = w.tool('Queries');
    const first = await w.until(core.loadDatabase(counting(buf), hit, LEAD, sharing(a)));
    const second = await w.until(core.loadDatabase(counting(buf), hit, LEAD, sharing(b)));
    // Chattar stänger sin databas, och minnet lämnas tillbaka.
    loose.drop();
    const readC = counting(buf);
    const third = await w.until(core.loadDatabase(readC, hit, LEAD, sharing(c)));
    assert.strictEqual(readC.calls, 0);
    assert.strictEqual(third.sharedBy, 'Chattar');
    assert.strictEqual(third.sharedLine, second.sharedLine);
    assert.ok(Buffer.from(third.bytes).equals(Buffer.from(first.bytes)));
});

test('utan huvudfönster, och utan filen att dela på, läser verktyget som förut', async () => {
    const { buf, hit } = await zipWith(await makeDb(12));
    const w = world();
    const lone = w.tool('Queries');
    lone.online = false;
    const read = counting(buf);
    const alone = await core.loadDatabase(read, hit, LEAD, sharing(lone));
    assert.ok(read.calls > 0);
    assert.deepStrictEqual(lone.sent, []);
    assert.strictEqual(alone.sharedBy, '');
    // Utan fil finns inget att känna igen databasen på.
    const b = w.tool('Härkomst');
    await core.loadDatabase(counting(buf), hit, LEAD, { share: { file: null, client: b.client } });
    assert.deepStrictEqual(b.sent, []);
});

test('en rapport (UFDR): raden säger rapporten', async () => {
    const T = Date.UTC(2026, 10, 3);
    const { buf } = buildUfdr([{ path: '/' + PATH, data: Buffer.from(await makeDb(12)), tag: 'Database', c: T, m: T, a: T }]);
    const slice = (from, to) => ({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset + from, buf.byteOffset + Math.min(to, buf.length)) });
    const source = await core.openSource({ name: 'rapport.ufdr', size: buf.length, lastModified: 1, slice });
    const hit = (await core.open(source.read, buf.length, TARGETS)).found[0];
    const w = world();
    const file = { name: 'rapport.ufdr', size: buf.length, lastModified: 1 };
    const first = await w.until(core.loadDatabase(source.read, hit, [], { share: { file, client: w.tool('Queries').client } }));
    const second = await w.until(core.loadDatabase(async () => { throw new Error('ska inte läsas'); }, hit, [], { share: { file, client: w.tool('Chattar').client } }));
    assert.match(second.sharedLine, /^Läst ur rapporten av Queries /);
    assert.ok(Buffer.from(second.bytes).equals(Buffer.from(first.bytes)));
});

test('stageText: vad som händer, kort i en rad som redan säger databasen och annars med dess namn', () => {
    const X = 'Signal (signal.sqlite)';
    assert.strictEqual(core.stageText('read'), 'läser filen…');
    assert.strictEqual(core.stageText('read', null, '', X), 'Läser Signal (signal.sqlite)…');
    assert.strictEqual(core.stageText('hash'), 'räknar SHA-256…');
    assert.strictEqual(core.stageText('hash', null, '', X), 'Räknar SHA-256 för Signal (signal.sqlite)…');
    assert.strictEqual(core.stageText('decrypt', 0.5), 'dekrypterar… 50 %');
    assert.strictEqual(core.stageText('decrypt', 0.999, '', X), 'Dekrypterar Signal (signal.sqlite)… 100 %');
    assert.strictEqual(core.stageText('decrypt-slow', 0.25, '', X), 'Dekrypterar Signal (signal.sqlite) utan webbläsarens inbyggda kryptering, så det går långsammare… 25 %');
    assert.strictEqual(core.stageText('wal', null, '', X), 'Lägger på -wal för Signal (signal.sqlite)…');
    assert.strictEqual(core.stageText('wait', null, 'Chattar', X, null), 'Väntar på Signal (signal.sqlite), som Chattar redan läser in…');
    assert.strictEqual(core.stageText('wait', 0.4, 'Chattar', X, 'decrypt'), 'Väntar på Signal (signal.sqlite), som Chattar redan läser in (dekrypterar… 40 %)');
    assert.strictEqual(core.stageText('wait', 0.4, 'Chattar', '', 'decrypt'), 'väntar på databasen, som Chattar redan läser in (dekrypterar… 40 %)');
    assert.strictEqual(core.stageText('copy', null, 'Chattar', X), 'Hämtar Signal (signal.sqlite) från Chattar, som redan har läst den…');
});
