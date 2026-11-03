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
