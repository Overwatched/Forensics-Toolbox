// Nycklarna till Signal ur secrets.json, android_keystore och det undersökaren klistrar in.
// Formen på secrets.json är den som setts i en verklig extraktion (Android); nycklarna här är påhittade.

const test = require('node:test');
const assert = require('node:assert');
const s = require('./app-secrets');

const DB_KEY = 'a3f00d9478eb7753e39c5a41a670c93e0de07a916fc97f3a79fed11daa0ecc5a';
const MODERN = 'oaPq2nB0X7J1c3kq8m1yTQ0n6O9a3c1oVq9zR2x4YkE';

const SECRETS = JSON.stringify([
    { app: 'org.thoughtcrime.securesms', script_output: [
        { payload: { 'sqlite db key': DB_KEY.toUpperCase() } },
        { payload: { 'signal attachment key': { classicCipherKey: null, classicMacKey: null, modernKey: MODERN } } },
    ], script_title: 'signal extraction', user_id: 0 },
    { app: 'com.microsoft.skydrive', script_output: [{ payload: { unwrappedKey: 'ab'.repeat(32) } }], script_title: 'OneDrive extraction', user_id: 0 },
]);

test('secrets.json: databasnyckel och bilagenyckel för Signal, andra appar påverkar inte', () => {
    assert.ok(s.isSecretsPath('extra/Secrets/secrets.json'));
    assert.ok(s.isSecretsPath('Dump/../extra/Secrets/secrets.json'));
    assert.ok(!s.isSecretsPath('data/extra/Secrets/secrets.json.bak'));
    const found = s.fromSecretsFile(Buffer.from(SECRETS));
    assert.deepStrictEqual(found.apps['org.thoughtcrime.securesms'], { dbKey: DB_KEY, modernKey: MODERN, notes: ['signal extraction'] });
    assert.ok(!found.apps['com.microsoft.skydrive'] || !found.apps['com.microsoft.skydrive'].dbKey);
    assert.deepStrictEqual(s.signalKeys([found]), { dbKey: DB_KEY, modernKey: MODERN, source: 'extra/Secrets/secrets.json', modernSource: 'extra/Secrets/secrets.json' });
    assert.match(s.fromSecretsFile('{inte json').error, /JSON/);
});

test('android_keystore: en Signal-post (formatet är inte kontrollerat mot en riktig extraktion)', () => {
    const attachmentJson = JSON.stringify({ classicCipherKey: 'x', classicMacKey: 'y', modernKey: MODERN });
    const ks = JSON.stringify({
        'org.thoughtcrime.securesms': [
            { result_type: 'Data Blob', description: 'pref_database_encrypted_secret', key_name: 'SignalSecret', encrypted_data: 'ff'.repeat(48), decrypted_data: DB_KEY },
            { result_type: 'Data Blob', description: 'pref_attachment_encrypted_secret', key_name: 'SignalSecret', encrypted_data: 'ee'.repeat(90), decrypted_data: Buffer.from(attachmentJson).toString('hex') },
        ],
        'com.defi.wallet': [{ result_type: 'Data Blob', description: 'pass-code-alias', key_name: 'pass-code-alias', encrypted_data: '00', decrypted_data: '313233' }],
    });
    const found = s.fromKeystoreFile(Buffer.from(ks), 'nyckelfil.zip');
    assert.deepStrictEqual(s.signalKeys([found]), { dbKey: DB_KEY, modernKey: MODERN, source: 'nyckelfil.zip', modernSource: 'nyckelfil.zip' });
});

test('inklistrat: hex, x\'…\', base64 och JSON; inklistrat går före extraktionens fil', () => {
    assert.deepStrictEqual(s.parseManual(DB_KEY), { dbKey: DB_KEY, modernKey: null });
    assert.deepStrictEqual(s.parseManual("x'" + DB_KEY.toUpperCase() + "'"), { dbKey: DB_KEY, modernKey: null });
    assert.deepStrictEqual(s.parseManual(DB_KEY + '\n' + MODERN), { dbKey: DB_KEY, modernKey: MODERN });
    assert.deepStrictEqual(s.parseManual('{"modernKey":"' + MODERN + '"}'), { dbKey: null, modernKey: MODERN });
    assert.deepStrictEqual(s.parseManual('{"sqlite db key":"' + DB_KEY + '"}'), { dbKey: DB_KEY, modernKey: null });
    assert.deepStrictEqual(s.parseManual('hej'), { dbKey: null, modernKey: null });
    const manual = Object.assign({ source: 'inklistrad' }, s.parseManual(DB_KEY.replace(/^a/, 'b')));
    assert.strictEqual(s.signalKeys([manual, s.fromSecretsFile(SECRETS)]).dbKey, DB_KEY.replace(/^a/, 'b'));
    assert.strictEqual(s.signalKeys([null, { source: 'x', apps: {} }]), null);
});

// En inklistrad nyckel av det ena slaget ska inte dölja nyckeln av det andra slaget i extraktionens fil.
test('varje nyckel tas ur den första källan som har den', () => {
    const fromFile = s.fromSecretsFile(SECRETS);
    const onlyModern = Object.assign({ source: 'inklistrad' }, s.parseManual(MODERN));
    assert.deepStrictEqual(s.signalKeys([onlyModern, fromFile]), { dbKey: DB_KEY, modernKey: MODERN, source: 'extra/Secrets/secrets.json', modernSource: 'inklistrad' });
    const otherDb = DB_KEY.replace(/^a/, 'b');
    const onlyDb = Object.assign({ source: 'inklistrad' }, s.parseManual(otherDb));
    assert.deepStrictEqual(s.signalKeys([onlyDb, fromFile]), { dbKey: otherDb, modernKey: MODERN, source: 'inklistrad', modernSource: 'extra/Secrets/secrets.json' });
    assert.deepStrictEqual(s.signalKeys([onlyModern]), { dbKey: null, modernKey: MODERN, source: 'inklistrad', modernSource: 'inklistrad' });
});

// ---------- Nyckelringen från iOS (plist bredvid zippen) ----------

require('../ios-keychain/lib/bplist.js');

// plistlib.dumps(…, fmt=FMT_BINARY): en WhatsApp-post och Signals post, där kontot står som data.
// Nyckeln är byten 0–47, ingen riktig nyckel.
const KEYCHAIN_BPLIST = 'YnBsaXN0MDDUAQIDBAUGFBlUY2VydFRnZW5wVGluZXRUa2V5c6CiBw/UCAkKCwwNDA5UYWNjdFRhZ3JwVHN2Y2VWdl9EYXRhV0F4b2xvdGxfECJncm91cC5uZXQud2hhdHNhcHAuV2hhdHNBcHAuc2hhcmVkTxBFAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB1AgJCgsQERITTxAZR1JEQkRhdGFiYXNlQ2lwaGVyS2V5U3BlY18QJFU2OE1TRE42RFIub3JnLndoaXNwZXJzeXN0ZW1zLnNpZ25hbF8QE0dSREJLZXlDaGFpblNlcnZpY2VPEDAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi+hFdIWCxcYVHNydnJbZXhhbXBsZS5vcmdBeKAACAARABYAGwAgACUAJgApADIANwA8AEEASABQAHUAvQDGAOIBCQEfAVIBVAFZAV4BagFsAAAAAAAAAgEAAAAAAAAAGgAAAAAAAAAAAAAAAAAAAW0=';
const KEY_HEX = Array.from({ length: 48 }, (_, i) => (i < 16 ? '0' : '') + i.toString(16)).join('');

test('nyckelringen som binär plist: Signals databasnyckel (48 byte) blir 96 hextecken', () => {
    const r = s.fromKeyFile(new Uint8Array(Buffer.from(KEYCHAIN_BPLIST, 'base64')), 'X_keychain.plist');
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.kind, 'keychain');
    assert.strictEqual(r.items, 3);
    assert.strictEqual(r.apps[s.SIGNAL_IOS].dbKey, KEY_HEX);
    assert.match(r.apps[s.SIGNAL_IOS].notes[0], /GRDBKeyChainService \/ GRDBDatabaseCipherKeySpec \(U68MSDN6DR\.org\.whispersystems\.signal\)/);
    assert.deepStrictEqual(s.keysForProfile([null, r], 'signal-ios'), { dbKey: KEY_HEX, modernKey: null, source: 'X_keychain.plist', modernSource: null });
    assert.strictEqual(s.keysForProfile([r], 'signal'), null, 'Androids Signal finns inte i nyckelringen');
});

test('nyckelringen som XML-plist, med entiteter, tomma värden och kommentarer', () => {
    const b64 = Buffer.from(KEY_HEX, 'hex').toString('base64');
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict>\n  <!-- en kommentar -->\n  <key>genp</key><array>\n' +
        '    <dict><key>svce</key><string>A &amp; B &lt;x&gt; &#229;</string><key>acct</key><string/><key>sync</key><false/><key>n</key><integer>7</integer></dict>\n' +
        '    <dict><key>svce</key><string>GRDBKeyChainService</string><key>acct</key><string>GRDBDatabaseCipherKeySpec</string>\n' +
        '      <key>v_Data</key><data>\n' + b64.slice(0, 40) + '\n' + b64.slice(40) + '\n</data></dict>\n' +
        '  </array><key>inet</key><array/></dict></plist>\n';
    const p = s.parseXmlPlist(xml);
    assert.strictEqual(p.genp[0].svce, 'A & B <x> å');
    assert.deepStrictEqual([p.genp[0].acct, p.genp[0].sync, p.genp[0].n], ['', false, 7]);
    const r = s.fromKeyFile(new Uint8Array(Buffer.from(xml)), 'keychain.plist');
    assert.strictEqual(r.apps[s.SIGNAL_IOS].dbKey, KEY_HEX);
    assert.strictEqual(r.items, 2);
});

test('nyckelfiler: fel format sägs, JSON går till rätt tolk, namnen känns igen', () => {
    assert.match(s.fromKeyFile(new Uint8Array(Buffer.from('<plist><dict><key>x</key><string>y</string></dict></plist>')), 'k.plist').error, /ingen nyckelring/);
    assert.match(s.fromKeyFile(new Uint8Array(Buffer.from('<plist><dict><key>x</key>')), 'k.plist').error, /gick inte att läsa/);
    assert.match(s.fromKeyFile(new Uint8Array(Buffer.from('inte en nyckel')), 'x.txt').error, /ingen nyckelfil/);
    const secrets = s.fromKeyFile(new Uint8Array(Buffer.from(JSON.stringify([{ app: s.SIGNAL, script_output: [{ payload: { 'sqlite db key': 'ab'.repeat(32) } }] }]))), 'secrets.json');
    assert.strictEqual(secrets.apps[s.SIGNAL].dbKey, 'ab'.repeat(32));
    assert.deepStrictEqual(['A_keychain.plist', 'keychain-backup.plist', 'secrets.json', 'X_android_keystore.zip', 'Photos.sqlite', 'Info.plist'].map(s.isKeyFileName), [true, true, true, true, false, false]);
    assert.strictEqual(s.keyHint('signal-ios'), 'nyckelringen (…_keychain.plist)');
});

test('inklistrad nyckel: 96 hextecken (gärna x\'…\') gäller iOS, 64 gäller Android', () => {
    const ios = s.parseManual("x'" + KEY_HEX.toUpperCase() + "'");
    assert.strictEqual(ios.dbKey, KEY_HEX);
    assert.strictEqual(s.keysForProfile([ios], 'signal-ios').dbKey, KEY_HEX);
    assert.strictEqual(s.keysForProfile([ios], 'signal'), null);
    const android = s.parseManual('ab'.repeat(32));
    assert.strictEqual(s.keysForProfile([android], 'signal-ios'), null);
    assert.strictEqual(s.keysForProfile([android], 'signal').dbKey, 'ab'.repeat(32));
});

// ---------- Var nycklarna letas ----------

test('nyckelfiler under extra/: högst upp eller i en mapp, aldrig bland telefonens egna filer', () => {
    ['extra/KeychainDump/backup_keychain_v2.plist', 'extra/Secrets/secrets.json', 'extra/keystore/android_keystore', 'Dump/extra/KeychainDump/x_keychain.plist', 'extra/y_keychain.plist'].forEach((n) => assert.ok(s.isExtraKeyPath(n), n));
    ['filesystem1/extra/z_keychain.plist', 'filesystem1/private/var/mobile/extra/z_keychain.plist', '/private/var/extra/keychain.plist', 'extra/KeychainDump/annan.plist', 'extra/Secrets/secrets.json.bak', 'private/var/Keychains/keychain-2.db', 'data/data/io.metamask/files/keystore.pb'].forEach((n) => assert.ok(!s.isExtraKeyPath(n), n));
});

test('nyckelfiler bredvid zippen: samma id avgör, och en annan telefons fil väljs aldrig', () => {
    const UDID = '00008030-0000000000000001', OTHER = '00008030-00000000AAAAAAAA';
    assert.strictEqual(s.deviceIdOf(UDID + '_fs.zip'), UDID.toLowerCase());
    assert.strictEqual(s.deviceIdOf('12345ABCDE6789_files_full.zip'), '12345abcde6789');
    assert.strictEqual(s.deviceIdOf('EXTRACTION_FFS.zip'), null, 'bara bokstäver är inget id');
    assert.strictEqual(s.deviceIdOf('backup_keychain_v2.plist'), null);
    // Samma id, också när andra telefoners filer ligger i mappen.
    assert.deepStrictEqual(s.besideKeyFiles(UDID + '_fs.zip', [UDID + '_fs.zip', UDID + '_keychain.plist', OTHER + '_fs.zip', OTHER + '_keychain.plist', 'anteckningar.txt']), { use: [UDID + '_keychain.plist'], other: [] });
    assert.deepStrictEqual(s.besideKeyFiles('12345ABCDE6789_files_full.zip', ['12345ABCDE6789_files_full.zip', '12345ABCDE6789_android_keystore.zip']), { use: ['12345ABCDE6789_android_keystore.zip'], other: [] });
    // Ingen av namnen bär ett id: en enda fil duger.
    assert.deepStrictEqual(s.besideKeyFiles('EXTRACTION_FFS.zip', ['EXTRACTION_FFS.zip', 'EXTRACTION_FFS.ufd', 'backup_keychain_v2.plist']), { use: ['backup_keychain_v2.plist'], other: [] });
    assert.deepStrictEqual(s.besideKeyFiles(UDID + '_fs.zip', ['backup_keychain_v2.plist']), { use: ['backup_keychain_v2.plist'], other: [] });
    // En annan telefons fil, ensam eller bland flera: ingen väljs, och den nämns.
    assert.deepStrictEqual(s.besideKeyFiles(UDID + '_fs.zip', [OTHER + '_keychain.plist']), { use: [], other: [OTHER + '_keychain.plist'] });
    assert.deepStrictEqual(s.besideKeyFiles(UDID + '_fs.zip', [OTHER + '_keychain.plist', 'keychain.plist']), { use: ['keychain.plist'], other: [] });
    // Flera utan id går inte att skilja åt.
    assert.deepStrictEqual(s.besideKeyFiles('EXTRACTION_FFS.zip', ['a_keychain.plist', 'b_keychain.plist']), { use: [], other: ['a_keychain.plist', 'b_keychain.plist'] });
    assert.deepStrictEqual(s.besideKeyFiles('EXTRACTION_FFS.zip', ['IMG_0001.JPG', 'Photos.sqlite']), { use: [], other: [] });
    assert.deepStrictEqual(s.besideKeyFiles(UDID + '_android_keystore.zip', [UDID + '_android_keystore.zip']), { use: [], other: [] }, 'filen själv räknas inte');
});

test('beskedet när nyckeln saknas säger var programmet letade och vad som återstår', () => {
    assert.strictEqual(s.missingKeyText({ profile: 'signal-ios', word: 'zippen', search: { lookedBeside: true, other: [] } }),
        'Ingen nyckel hittades under extra/ i zippen eller bredvid den. Välj nyckelringen (…_keychain.plist) med Nyckelfil…, eller klistra in nyckeln. Den sparas inte.');
    assert.strictEqual(s.missingKeyText({ profile: 'signal', word: 'zippen', search: { lookedBeside: false, other: [] } }),
        'Ingen nyckel hittades under extra/ i zippen. En webbläsare får inte se mappen där zippen ligger. Välj nyckelfilen (…_android_keystore.zip eller secrets.json) med Nyckelfil…, eller klistra in nyckeln. Den sparas inte.');
    assert.match(s.missingKeyText({ profile: 'signal-ios', word: 'zippen', search: { lookedBeside: true, other: ['a_keychain.plist', 'b_keychain.plist'] } }),
        /^Ingen nyckel hittades under extra\/ i zippen\. Bredvid zippen ligger a_keychain\.plist, b_keychain\.plist, men inget visar att de hör till den\. Välj/);
    assert.match(s.missingKeyText({ profile: 'signal-ios', word: 'rapporten', search: { lookedBeside: true, other: [] } }), /^Ingen nyckel hittades i rapporten eller bredvid den\./);
    assert.match(s.missingKeyText({ profile: 'signal-ios', word: 'rapporten', search: null }), /^Ingen nyckel hittades i rapporten\. En webbläsare får inte se mappen där rapporten ligger\./);
});

test('hasSignalKey: bara Signals databasnyckel räknas', () => {
    assert.ok(s.hasSignalKey([s.fromSecretsFile(SECRETS)]));
    assert.ok(s.hasSignalKey([s.fromKeyFile(new Uint8Array(Buffer.from(KEYCHAIN_BPLIST, 'base64')), 'k')]));
    assert.ok(!s.hasSignalKey([{ source: 'x', apps: { 'com.annan.app': { dbKey: 'ab'.repeat(32) } } }, { source: 'y', apps: {}, error: 'trasig' }]));
    assert.ok(!s.hasSignalKey([]));
});

// ---------- Nyckelringen med krypterade poster ----------

require('../ios-keychain/lib/asn1.js');
const { encryptedKeychain } = require('./fixtures/keychain-builder');
const SIGNAL_ITEM = { svce: 'GRDBKeyChainService', acct: 'GRDBDatabaseCipherKeySpec', agrp: 'U68MSDN6DR.org.whispersystems.signal', value: Buffer.from(KEY_HEX, 'hex') };
const OTHER_ITEM = { svce: 'com.annan.app', acct: 'konto', agrp: 'X.com.annan.app', value: Buffer.from('hemligt') };
const xmlBytes = (items) => new Uint8Array(Buffer.from(encryptedKeychain(items)));

test('krypterade poster: Signals nyckel hittas, och andra poster påverkar inte', async () => {
    const r = await s.readKeyBytes(xmlBytes([OTHER_ITEM, SIGNAL_ITEM, Object.assign({}, OTHER_ITEM, { table: 'inet' })]), 'extra/KeychainDump/backup_keychain_v2.plist i zippen');
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.kind, 'keychain');
    assert.strictEqual(r.items, 3);
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(r.apps[s.SIGNAL_IOS].dbKey, KEY_HEX);
    assert.match(r.apps[s.SIGNAL_IOS].notes[0], /U68MSDN6DR\.org\.whispersystems\.signal/);
    assert.deepStrictEqual(s.keysForProfile([r], 'signal-ios'), { dbKey: KEY_HEX, modernKey: null, source: 'extra/KeychainDump/backup_keychain_v2.plist i zippen', modernSource: null });
    assert.ok(s.hasSignalKey([r]));
    // Utan Signal i nyckelringen: inget fel och ingen nyckel.
    const none = await s.readKeyBytes(xmlBytes([OTHER_ITEM]), 'k.plist');
    assert.strictEqual(none.error, undefined);
    assert.deepStrictEqual(none.apps, {});
});

test('krypterade poster: bara Signals värde dekrypteras, en trasig annan post stör inte', async () => {
    // Värdet i den andra posten har fel kontrollsumma. Det dekrypteras aldrig, så det räknas inte som fel.
    const r = await s.readKeyBytes(xmlBytes([Object.assign({}, OTHER_ITEM, { damage: 'data' }), SIGNAL_ITEM]), 'k.plist');
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(r.apps[s.SIGNAL_IOS].dbKey, KEY_HEX);
});

test('krypterade poster: fel kontrollsumma, klassnyckel eller TamperCheck ger ingen nyckel och sägs', async () => {
    for (const damage of ['metadata', 'classkey', 'data', 'tamper', 'tamper-meta']) {
        const r = await s.readKeyBytes(xmlBytes([OTHER_ITEM, Object.assign({}, SIGNAL_ITEM, { damage })]), 'k.plist');
        assert.deepStrictEqual(r.apps, {}, damage);
        assert.strictEqual(r.failed, 1, damage);
        assert.match(r.error, /^1 av 2 poster i nyckelringen gick inte att dekryptera/, damage);
    }
    // Går en annan post inte att öppna, men Signals nyckel finns, är inget fel att säga till om.
    const ok = await s.readKeyBytes(xmlBytes([Object.assign({}, OTHER_ITEM, { damage: 'metadata' }), SIGNAL_ITEM]), 'k.plist');
    assert.strictEqual(ok.failed, 1);
    assert.strictEqual(ok.error, undefined);
    assert.strictEqual(ok.apps[s.SIGNAL_IOS].dbKey, KEY_HEX);
});

test('krypterade poster: bara listan genp läses, som i plisten med öppna poster', async () => {
    const r = await s.readKeyBytes(xmlBytes([Object.assign({}, SIGNAL_ITEM, { table: 'inet' }), Object.assign({}, OTHER_ITEM, { table: 'keys', damage: 'metadata' })]), 'k.plist');
    assert.deepStrictEqual(r.apps, {});
    assert.strictEqual(r.failed, 0, 'poster i andra listor öppnas inte');
    assert.strictEqual(r.items, 2);
});

test('Signals värde med fel längd används inte, som i plisten med öppna poster', async () => {
    const r = await s.readKeyBytes(xmlBytes([Object.assign({}, SIGNAL_ITEM, { value: Buffer.alloc(32, 1) })]), 'k.plist');
    assert.deepStrictEqual(r.apps, {});
    assert.strictEqual(r.failed, 0);
});

test('readKeyBytes tar också de vanliga formaten, och skiljer på dem efter innehållet', async () => {
    assert.strictEqual((await s.readKeyBytes(new Uint8Array(Buffer.from(KEYCHAIN_BPLIST, 'base64')), 'X_keychain.plist')).apps[s.SIGNAL_IOS].dbKey, KEY_HEX);
    assert.strictEqual((await s.readKeyBytes(new Uint8Array(Buffer.from(SECRETS)), 'secrets.json')).apps[s.SIGNAL].dbKey, DB_KEY);
    assert.match((await s.readKeyBytes(new Uint8Array(Buffer.from('<plist><dict><key>x</key>')), 'k.plist')).error, /gick inte att läsa/);
    assert.match((await s.readKeyBytes(new Uint8Array(Buffer.from('inte en nyckel')), 'x.txt')).error, /ingen nyckelfil/);
});
