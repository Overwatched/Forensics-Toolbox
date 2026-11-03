// Appversionerna till protokollet: Info.plist (bplist och XML), packages.xml (ABX och text),
// Snapchats user agent och Signals loggrader.

const test = require('node:test');
const assert = require('node:assert');
const v = require('./app-versions');
const logs = require('./android-logs');
require('../ios-keychain/lib/bplist.js');

// plistlib.dumps({...}, fmt=FMT_BINARY) för en Snapchat-liknande Info.plist.
const BPLIST = 'YnBsaXN0MDDUAQIDBAUGBwhfEBJDRkJ1bmRsZUlkZW50aWZpZXJcQ0ZCdW5kbGVOYW1lXxAaQ0ZCdW5kbGVTaG9ydFZlcnNpb25TdHJpbmdfEA9DRkJ1bmRsZVZlcnNpb25fEBdjb20udG95b3BhZ3JvdXAucGljYWJvb1hTbmFwY2hhdFcxMy40MC4wWjEzLjQwLjAuMzcIESYzUGJ8hY0AAAAAAAABAQAAAAAAAAAJAAAAAAAAAAAAAAAAAAAAmA==';

test('Info.plist som bplist och som XML', () => {
    const bin = new Uint8Array(Buffer.from(BPLIST, 'base64'));
    assert.deepStrictEqual(v.fromInfoPlist(bin, globalThis.KC.bplist.parse), { bundleId: 'com.toyopagroup.picaboo', version: '13.40.0', build: '13.40.0.37' });
    assert.strictEqual(v.fromInfoPlist(bin, null), null);
    const xml = '<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>org.whispersystems.signal</string>' +
        '<key>CFBundleShortVersionString</key><string>7.80</string><key>CFBundleVersion</key><string>7.80.0.12</string></dict></plist>';
    assert.deepStrictEqual(v.fromInfoPlist(new Uint8Array(Buffer.from(xml)), null), { bundleId: 'org.whispersystems.signal', version: '7.80', build: '7.80.0.12' });
    assert.strictEqual(v.fromInfoPlist(new Uint8Array(Buffer.from('<plist><dict></dict></plist>')), null), null);
});

// En liten packages.xml i Androids binära XML (ABX), byggd som telefonen skriver den.
function abx(packages) {
    const out = [0x41, 0x42, 0x58, 0x00, 0x10];
    const table = [];
    const intern = (s) => {
        const i = table.indexOf(s);
        if (i >= 0) return [i >> 8, i & 255];
        table.push(s);
        const b = [...Buffer.from(s, 'utf8')];
        return [0xff, 0xff, b.length >> 8, b.length & 255, ...b];
    };
    const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return [...b]; };
    const int64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return [...b]; };
    out.push(0x32, ...intern('packages'));
    packages.forEach((p) => {
        out.push(0x32, ...intern('package'));
        out.push(0x3f, ...intern('name'), ...intern(p.name));
        out.push(0x6f, ...intern('version'), ...int32(p.version));
        out.push(0x9f, ...intern('it'), ...int64(p.it));
        out.push(0x9f, ...intern('ut'), ...int64(p.ut));
        out.push(0x33, ...intern('package'));
    });
    out.push(0x33, ...intern('packages'), 0x11);
    return new Uint8Array(out);
}

test('packages.xml: versionskod och tider, i ABX och som text', () => {
    const bin = abx([{ name: 'com.android.chrome', version: 1, it: 5, ut: 6 }, { name: 'com.snapchat.android', version: 145234, it: 1761868800000, ut: 1761955200000 }]);
    assert.deepStrictEqual(v.fromPackagesXml(bin, 'com.snapchat.android', logs.abxParse), { versionCode: 145234, fileMs: null, installMs: 1761868800000, updateMs: 1761955200000 });
    assert.strictEqual(v.fromPackagesXml(bin, 'org.thoughtcrime.securesms', logs.abxParse), null);
    const text = '<?xml version="1.0"?><packages><package name="org.thoughtcrime.securesms" codePath="/data/app/x" ft="19a3c1e9f00" it="19a3c1e9f00" ut="19a42c2a800" version="177201" userId="10259"></package></packages>';
    assert.deepStrictEqual(v.fromPackagesXml(new Uint8Array(Buffer.from(text)), 'org.thoughtcrime.securesms', null),
        { versionCode: 177201, fileMs: 0x19a3c1e9f00, installMs: 0x19a3c1e9f00, updateMs: 0x19a42c2a800 });
});

test('Snapchats user agent och Signals logg', () => {
    assert.strictEqual(v.fromUserAgent('Snapchat/14.30.0.54 (AC2003; Android 13#f8fb74d040#33; gzip)'), '14.30.0.54');
    assert.strictEqual(v.fromUserAgent('okänd'), null);
    const rows = [
        { timeMs: 1000, body: '[8.32.0] [main] 2026-11-01 10:00:00.000 GMT+01:00 I X: y' },
        { timeMs: 9000, body: '[8.33.2] [main] 2026-11-02 18:47:59.420 GMT+01:00 D X: y' },
        { timeMs: 9500, body: 'utan version' },
    ];
    assert.deepStrictEqual(v.fromSignalLog(rows, 8000), { version: '8.33.2', ms: 9000 });
    assert.deepStrictEqual(v.fromSignalLog(rows, 1200), { version: '8.32.0', ms: 1000 });
    assert.strictEqual(v.fromSignalLog([], 1), null);
});

test('texten i protokollet', () => {
    assert.strictEqual(v.text([
        { app: 'Snapchat', version: '13.40.0', build: '13.40.0.37', source: 'Snapchat.app/Info.plist i appens paket', note: 'installerad när extraktionen gjordes' },
        { app: 'Signal', versionCode: 177201, source: 'data/system/packages.xml' },
    ]), 'Snapchat 13.40.0 (build 13.40.0.37) (Snapchat.app/Info.plist i appens paket; installerad när extraktionen gjordes). Signal versionskod 177201 (data/system/packages.xml).');
    assert.strictEqual(v.text([]), '');
});
