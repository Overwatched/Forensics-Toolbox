// Tor Browsers filer utanför databaserna, i labbtelefonens form (Tor Browser 16.0.2, Android 13, 2026-11-21).
// Nickname och nycklar i vakterna är påhittade.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./torbrowser.js');

const STATE = `# Tor state file last generated on 2026-11-21 14:05:32 local time
# Other times below are in UTC
# You *do not* need to edit this file.

CircuitBuildTimeBin 145 1
Dormant 0
Guard in=default rsa_id=AAAA nickname=nod1 sampled_on=2026-11-11T12:16:55 sampled_idx=0 sampled_by=0.4.9.16 listed=1
Guard in=default rsa_id=BBBB nickname=nod2 sampled_on=2026-11-10T05:53:27 sampled_idx=1 sampled_by=0.4.9.16 listed=1
LastWritten 2026-11-21 13:05:32
TorVersion Tor 0.4.9.16 (git-c51547ca15ea6659)
TotalBuildTimes 29
`;

const PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="pref_key_extensions_version">153.7.0-20261110150000-5290963f</string>
    <int name="pref_key_app_cold_start_count" value="1" />
    <boolean name="pref_key_last_known_mode_private" value="true" />
    <long name="pref_key_last_browse_activity_time" value="1795266278027" />
    <long name="pref_key_growth_usage_time" value="52363" />
    <int name="pref_key_times_app_opened" value="1" />
    <int name="pref_key_app_launch_count" value="1" />
    <long name="pref_key_last_home_activity_time" value="1795266277973" />
    <string name="annat">a &amp; b</string>
</map>`;

test('tor/state: senaste skrivningen, versionen och kretsarna; vakterna räknas bara', () => {
    const s = T.torState(STATE);
    assert.strictEqual(s.lastWrittenMs, Date.UTC(2026, 10, 21, 13, 5, 32));
    assert.strictEqual(s.version, '0.4.9.16');
    assert.strictEqual(s.builds, 29);
    assert.strictEqual(s.guards, 2);
    assert.strictEqual(s.dormant, false);
    assert.strictEqual(T.consensusValidAfter('network-status-version 3 microdesc\nvote-status consensus\nvalid-after 2026-11-21 12:00:00\n'), Date.UTC(2026, 10, 21, 12));
});

test('fenix_preferences.xml: surfaktivitet, användningstid, starter och privat läge', () => {
    const p = T.fenixPrefs(PREFS);
    assert.deepStrictEqual(p, { lastBrowseMs: 1795266278027, lastHomeMs: 1795266277973, usageS: 52, launches: 1, opened: 1, coldStarts: 1, privateMode: true, version: '153.7.0' });
    assert.strictEqual(T.sharedPrefs(PREFS).annat, 'a & b');
    assert.deepStrictEqual(T.profileTimes('{"created": 1795266091865, "firstUse": null}'), { createdMs: 1795266091865, firstUseMs: null });
    assert.deepStrictEqual(T.profileTimes('trasig'), { createdMs: null, firstUseMs: null });
});

test('filerna känns igen i appens mapp, och bara för Gecko-webbläsare', () => {
    const base = 'Dump/data/data/org.torproject.torbrowser/';
    assert.deepStrictEqual(T.fileOf(base + 'files/tor/state'), { kind: 'state', pkg: 'org.torproject.torbrowser', private: undefined });
    assert.strictEqual(T.fileOf(base + 'shared_prefs/fenix_preferences.xml').kind, 'prefs');
    assert.strictEqual(T.fileOf(base + 'files/mozilla/5lfg423l.default/times.json').kind, 'times');
    assert.deepStrictEqual(T.fileOf(base + 'no_backup/mozac_browser_thumbnails/private_thumbnails/abc.0'), { kind: 'thumb', pkg: 'org.torproject.torbrowser', private: true });
    assert.strictEqual(T.fileOf('data/data/com.android.chrome/files/tor/state'), null);
    assert.ok(T.isTor('org.torproject.torbrowser') && !T.isTor('org.mozilla.firefox') && T.isGecko('org.mozilla.firefox'));
});
