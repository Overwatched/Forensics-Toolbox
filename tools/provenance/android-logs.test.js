// Androids systemloggar: ABX-avkodningen mot en riktig fil ur labbtelefonen (samma XML som
// abx2xml), appops-raderna till kameraintervall, och usagestats version 5 byggd för hand i
// samma protobuf-form som telefonen skriver.

const test = require('node:test');
const assert = require('node:assert');
const logs = require('./android-logs');
const core = require('./timeline-core');

// /data/system/appops/discrete/1793401800253tl ur labbtelefonen (155 byte): en rad för op 111.
const DISCRETE_HEX = '414258001032ffff0001686fffff000176000000016fffff00026c630000000032ffff0001756fffff00027569000003e832ffff0001702fffff0002706e0007616e64726f696432ffff00016f6fffff00026f700000006f32ffff00016132ffff0001658fffff00026e74000001a18f0f10516fffff00027573000000646fffff0001660000000133000a33000933000733000533000333000011';
const DISCRETE_XML = '<h v="1" lc="0">\n  <u ui="1000">\n    <p pn="android">\n      <o op="111">\n        <a>\n          <e nt="1793401491537" us="100" f="1" />\n        </a>\n      </o>\n    </p>\n  </u>\n</h>\n';

function varint(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; }
function len(field, bytes) { return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes]; }
function vint(field, n) { return [...varint(field * 8), ...varint(n)]; }
function str(field, s) { return len(field, [...Buffer.from(s, 'utf8')]); }

test('ABX ur labbtelefonen avkodas till samma XML som abx2xml', () => {
    const doc = logs.abxParse(Buffer.from(DISCRETE_HEX, 'hex'));
    assert.strictEqual(logs.abxToXml(doc), DISCRETE_XML);
    const h = doc.children[0];
    assert.strictEqual(h.name, 'h');
    assert.strictEqual(h.attrs.v, 1);
    assert.strictEqual(h.children[0].children[0].attrs.pn, 'android');
    assert.throws(() => logs.abxParse(Buffer.from('<?xml version="1.0"?>')), /inte ABX/);
});

test('appops-raderna: paket, op, tid, längd', () => {
    const rows = logs.discreteOps(Buffer.from(DISCRETE_HEX, 'hex'));
    assert.deepStrictEqual(rows, [{ uid: 1000, pkg: 'android', op: 111, attribution: null, ms: 1793401491537, durationMs: null, uidState: 100, flags: 1 }]);
});

test('kameraintervall: startraden och slutraden med samma nt slås ihop, utan slutrad är intervallet öppet', () => {
    const rows = [
        { pkg: 'com.snapchat.android', op: 26, ms: 1793404103663, durationMs: null, uid: 10258 },
        { pkg: 'com.snapchat.android', op: 26, ms: 1793404103663, durationMs: 16949, uid: 10258 },
        { pkg: 'com.snapchat.android', op: 27, ms: 1793404105036, durationMs: 5577, uid: 10258 },
        { pkg: 'com.snapchat.android', op: 26, ms: 1793404143942, durationMs: null, uid: 10258 },
        { pkg: 'org.lineageos.aperture', op: 26, ms: 1793404193744, durationMs: null, uid: 10300 },
        // Slutraden kom i en senare fil, utan ny startrad.
        { pkg: 'org.lineageos.aperture', op: 26, ms: 1793404193744, durationMs: 7484, uid: 10300 },
    ];
    const cam = logs.opIntervals(rows, logs.OP_CAMERA);
    assert.deepStrictEqual(cam.map((c) => [c.app, c.startMs, c.endMs, c.open]), [
        ['com.snapchat.android', 1793404103663, 1793404120612, false],
        ['com.snapchat.android', 1793404143942, null, true],
        ['org.lineageos.aperture', 1793404193744, 1793404201228, false],
    ]);
    assert.strictEqual(cam[0].opName, 'kamera');
    assert.strictEqual(logs.opIntervals(rows, logs.OP_MICROPHONE).length, 1);
    assert.strictEqual(logs.opIntervals(rows).length, 4);
});

test('sökvägarna till loggarna känns igen i båda layouterna', () => {
    assert.ok(logs.isDiscretePath('data/system/appops/discrete/1793401800253tl'));
    assert.ok(logs.isDiscretePath('filesystem1/data/system/appops/discrete/1793401800253tl'));
    assert.strictEqual(logs.discreteWrittenMs('data/system/appops/discrete/1793401800253tl'), 1793401800253);
    assert.ok(!logs.isDiscretePath('data/system/appops/history/x'));
    assert.ok(logs.isUsageDailyPath('data/system_ce/0/usagestats/daily/1793395080992'));
    assert.ok(logs.isUsageDailyPath('data/system/usagestats/0/daily/1793395080992'));
    assert.ok(!logs.isUsageDailyPath('data/system_ce/0/usagestats/weekly/1793395080992'));
    assert.ok(logs.isUsageMappingsPath('data/system_ce/0/usagestats/mappings'));
    assert.ok(logs.isUsageVersionPath('data/system_ce/0/usagestats/version'));
    assert.strictEqual(logs.dailyBeginMs('data/system_ce/0/usagestats/daily/1793395080992'), 1793395080992);
    const keep = logs.keeper();
    assert.ok(keep('data/system_ce/0/usagestats/mappings'));
    assert.ok(!keep('data/system_ce/0/usagestats/daily/'));
    assert.ok(!keep('data/media/0/DCIM/Camera/x.jpg'));
    const sorted = logs.sortEntries([
        { name: 'data/system_ce/0/usagestats/version' }, { name: 'data/system_ce/0/usagestats/mappings' }, { name: 'data/system_ce/0/usagestats/daily/1' }, { name: 'data/system_ce/0/usagestats/daily/2' },
        { name: 'data/system_ce/10/usagestats/daily/3' }, { name: 'data/system/appops/discrete/5tl' },
    ]);
    assert.strictEqual(sorted.user, 0);
    assert.strictEqual(sorted.daily.length, 2);
    assert.strictEqual(sorted.discrete.length, 1);
    assert.ok(sorted.mappings && sorted.version);
});

test('version-filen: databasversion och Android-version', () => {
    assert.deepStrictEqual(logs.usageVersion(Buffer.from('5\n13;REL;f8fb74d040\n')), { version: 5, release: '13', codename: 'REL', build: 'f8fb74d040', text: '5 / 13;REL;f8fb74d040' });
    assert.strictEqual(logs.usageVersion(Buffer.from('3\n')).version, 3);
    assert.strictEqual(logs.usageVersion(Buffer.from('')).version, null);
});

test('usagestats version 5: mappings och dagsfil ger händelser som blir intervall för app, skärm och lås', () => {
    // mappings: token 7 = com.snapchat.android med en klass, token 9 = android, token 12 = launcher
    const mappings = Uint8Array.from([
        ...len(2, [...vint(1, 7), ...str(2, 'com.snapchat.android'), ...str(2, 'com.snap.mushroom.MainActivity')]),
        ...len(2, [...vint(1, 9), ...str(2, 'android')]),
        ...len(2, [...vint(1, 12), ...str(2, 'com.android.launcher3'), ...str(2, 'com.android.launcher3.uioverrides.QuickstepLauncher')]),
    ]);
    const map = logs.usageMappings(mappings);
    assert.deepStrictEqual(map[7], ['com.snapchat.android', 'com.snap.mushroom.MainActivity']);
    const begin = 1793395080992;
    const ev = (pkgTok, clsTok, rel, type, instance) => len(22, [...vint(1, pkgTok), ...(clsTok ? vint(2, clsTok) : []), ...vint(3, rel), ...vint(5, type), ...(instance ? vint(10, instance) : [])]);
    const daily = Uint8Array.from([
        ...vint(1, 9420000), // end_time relativt begin
        ...ev(9, 0, 9008000, 15),            // 00:48:09 SCREEN_INTERACTIVE
        ...ev(12, 2, 9016000, 1, 87371010),  // launcher RESUMED (klasstoken 2 = strängar[1]; token 1 är paketet)
        ...ev(9, 0, 9016500, 18),            // KEYGUARD_HIDDEN
        ...ev(12, 2, 9017000, 2, 87371010),  // launcher PAUSED
        ...ev(7, 2, 9017500, 1, 221703704),  // Snapchat RESUMED
        ...ev(12, 2, 9018000, 23, 87371010), // launcher STOPPED
        ...ev(12, 2, 9018500, 30),           // LOCUS_ID_SET, ska filtreras bort
        ...ev(7, 2, 9110000, 2, 221703704),  // Snapchat PAUSED
        ...ev(9, 0, 9126000, 16),            // SCREEN_NON_INTERACTIVE
        ...ev(9, 0, 9126500, 17),            // KEYGUARD_SHOWN
    ]);
    const d = logs.usageDaily(daily, begin, map, 5);
    assert.strictEqual(d.endMs, begin + 9420000);
    assert.strictEqual(d.events.length, 10);
    assert.strictEqual(d.events[4].pkg, 'com.snapchat.android');
    assert.strictEqual(d.events[4].cls, 'com.snap.mushroom.MainActivity');
    assert.strictEqual(d.events[4].typeName, 'ACTIVITY_RESUMED');
    assert.strictEqual(d.events[4].instance, 221703704);
    const events = logs.usageToEvents([d]);
    assert.strictEqual(events.length, 9, 'LOCUS_ID_SET tas inte med');
    assert.strictEqual(events[0].app, 'android');
    const iv = core.intervalsFromEvents(events, begin + 9420000, { db: 'usagestats' });
    assert.deepStrictEqual(iv.apps.map((a) => [a.app, a.startMs - begin, a.endMs - begin]), [['com.android.launcher3', 9016000, 9017000], ['com.snapchat.android', 9017500, 9110000]]);
    assert.deepStrictEqual(iv.screen.map((s) => [s.on, s.startMs - begin, s.endMs - begin]), [[true, 9008000, 9126000], [false, 9126000, 9420000]]);
    assert.deepStrictEqual(iv.lock.map((l) => [l.locked, l.startMs - begin, l.endMs - begin]), [[false, 9016500, 9126500], [true, 9126500, 9420000]]);
    const cov = logs.usageCoverage([d]);
    assert.deepStrictEqual(cov, { firstMs: begin + 9008000, lastMs: begin + 9126500, rows: 10 });
});

test('usagestats version 4: strängpoolen i filen i stället för mappings', () => {
    const begin = 1700000000000;
    const pool = len(2, [...vint(1, 2), ...str(2, 'com.example.app'), ...str(2, 'com.example.app.Main')]);
    const ev = (pkgIdx, clsIdx, rel, type) => len(22, [...vint(1, pkgIdx), ...vint(2, clsIdx), ...vint(3, rel), ...vint(5, type)]);
    const daily = Uint8Array.from([...vint(1, 60000), ...pool, ...ev(1, 2, 1000, 1), ...ev(1, 2, 5000, 2)]);
    const d = logs.usageDaily(daily, begin, null, 4);
    assert.deepStrictEqual(d.events.map((e) => [e.pkg, e.cls, e.ms - begin, e.type]), [['com.example.app', 'com.example.app.Main', 1000, 1], ['com.example.app', 'com.example.app.Main', 5000, 2]]);
});

test('urvalet av dagsfiler och discrete-filer följer fönstret', () => {
    const daily = ['1793222260209', '1793308670783', '1793395080992'].map((n) => ({ name: 'data/system_ce/0/usagestats/daily/' + n }));
    const range = { startMs: 1793403000000, endMs: 1793405000000 }; // 31 okt 00:30–01:03
    assert.deepStrictEqual(logs.pickDaily(daily, range).map((e) => e.name.slice(-13)), ['1793395080992']);
    const wide = { startMs: 1793300000000, endMs: 1793400000000 };
    assert.deepStrictEqual(logs.pickDaily(daily, wide).map((e) => e.name.slice(-13)), ['1793222260209', '1793308670783', '1793395080992']);
    const discrete = ['1793401800253', '1793403250258', '1793404159162', '1793405337404'].map((n) => ({ name: 'data/system/appops/discrete/' + n + 'tl' }));
    assert.deepStrictEqual(logs.pickDiscrete(discrete, range).map((e) => e.name.slice(-15, -2)), ['1793403250258', '1793404159162', '1793405337404']);
    assert.strictEqual(logs.pickDiscrete(discrete, range, 2).length, 2);
});
