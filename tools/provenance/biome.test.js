// Biome: SEGB version 1 och 2 byggda för hand i samma form som telefonerna skriver (iOS 18.7 och 26.4), och
// fälten i App.InFocus och Notification.Usage.

const test = require('node:test');
const assert = require('node:assert');
const biome = require('./biome');

const MAC = 978307200;
function varint(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; }
function vint(field, n) { return [...varint(field * 8), ...varint(n)]; }
function str(field, s) { const b = [...Buffer.from(s, 'utf8')]; return [...varint(field * 8 + 2), ...varint(b.length), ...b]; }
function dbl(field, x) { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...varint(field * 8 + 1), ...b]; }
const mac = (iso) => Date.parse(iso) / 1000 - MAC;

// Version 2: huvud på 32 byte, posterna (crc, 1, data) efter varandra med 4-byteskant, och listan
// (slut relativt huvudet, läge, tid) baklänges i slutet av filen. En raderad post är nollad.
function segb2(records, size) {
    const buf = Buffer.alloc(size || 4096);
    buf.write('SEGB', 0, 'latin1');
    buf.writeInt32LE(records.length, 4);
    buf.writeDoubleLE(mac('2025-06-03T06:48:18Z'), 8);
    let prev = 0;
    records.forEach((r, k) => {
        const start = 32 + prev;
        const data = Buffer.from(r.data);
        if (r.state === 1) { buf.writeUInt32LE(biome.crc32(data), start); buf.writeInt32LE(1, start + 4); data.copy(buf, start + 8); }
        const end = start + 8 + data.length - 32;
        const at = buf.length - 16 * (k + 1);
        buf.writeInt32LE(end, at); buf.writeInt32LE(r.state, at + 4); buf.writeDoubleLE(mac(r.at), at + 8);
        prev = (end + 3) & ~3;
    });
    return buf;
}

// Version 1: slutet på datat först, SEGB på plats 52, posterna från 56 med ett huvud på 32 byte och 8-byteskant.
function segb1(records) {
    const buf = Buffer.alloc(4096);
    let i = 56;
    records.forEach((r) => {
        const data = Buffer.from(r.data);
        buf.writeInt32LE(data.length, i); buf.writeInt32LE(r.state, i + 4);
        buf.writeDoubleLE(mac(r.at), i + 8); buf.writeDoubleLE(mac(r.at), i + 16);
        if (r.state === 1) { buf.writeUInt32LE(biome.crc32(data), i + 24); data.copy(buf, i + 32); }
        i = (i + 32 + data.length + 7) & ~7;
    });
    buf.writeInt32LE(i, 0);
    buf.write('SEGB', 52, 'latin1');
    return buf;
}

const focus = (iso, starting, app, reason) => ({ at: iso, state: 1, data: [...(reason ? str(1, reason) : []), ...vint(2, 1), ...vint(3, starting ? 1 : 0), ...dbl(4, mac(iso)), ...str(6, app), ...str(10, '1.0')] });
const notice = (iso, notified, type, app, id, title) => ({ at: iso, state: 1, data: [...str(1, 'E' + iso), ...dbl(2, mac(notified)), ...vint(3, type), ...str(4, app), ...str(5, id), ...(title ? str(8, title) : [])] });

test('CRC32 som zlib', () => {
    assert.strictEqual(biome.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('SEGB version 2: poster, rensade poster och summor', () => {
    const file = segb2([
        { at: '2026-10-29T08:00:00Z', state: 3, data: Array(20).fill(0) },
        focus('2026-10-30T22:28:40.633Z', true, 'com.toyopagroup.picaboo', 'com.apple.SpringBoard.transitionReason.homescreen'),
        focus('2026-10-30T22:29:24.258Z', false, 'com.toyopagroup.picaboo'),
    ]);
    assert.ok(biome.isSegb(file));
    const s = biome.segb(file);
    assert.strictEqual(s.version, 2);
    assert.strictEqual(s.createdMs, Date.parse('2025-06-03T06:48:18Z'));
    assert.deepStrictEqual(s.records.map((r) => [r.state, r.crcOk]), [[3, null], [1, true], [1, true]]);
    const f = biome.appInFocus(file);
    assert.strictEqual(f.deleted, 1);
    assert.deepStrictEqual(f.rows.map((r) => [r.app, r.starting, r.ms, r.reason]), [
        ['com.toyopagroup.picaboo', true, Date.parse('2026-10-30T22:28:40.633Z'), 'com.apple.SpringBoard.transitionReason.homescreen'],
        ['com.toyopagroup.picaboo', false, Date.parse('2026-10-30T22:29:24.258Z'), null],
    ]);
    assert.deepStrictEqual(biome.focusToEvents(f.rows).map((e) => e.type), [1, 2]);
    // En ändrad byte i datat syns på summan.
    const bad = Buffer.from(file);
    bad[s.records[1].offset + 8 + 2] ^= 0xff;
    assert.strictEqual(biome.segb(bad).records[1].crcOk, false);
});

test('SEGB version 1: samma fält, längden i varje posts huvud', () => {
    const file = segb1([
        { at: '2026-09-15T08:30:00Z', state: 3, data: Array(30).fill(0) },
        notice('2026-09-15T08:37:57.281Z', '2026-09-15T08:37:56.159Z', 17, 'com.hammerandchisel.discord', 'ID-1', 'Bruno'),
        notice('2026-09-15T09:03:56.158Z', '2026-09-15T08:37:56.159Z', 7, 'com.hammerandchisel.discord', 'ID-1', 'Bruno'),
    ]);
    assert.strictEqual(biome.segb(file).version, 1);
    const n = biome.notificationUsage(file);
    assert.strictEqual(n.rows.length, 2);
    assert.deepStrictEqual(n.rows.map((r) => [r.type, r.app, r.title, r.notifiedMs]), [
        [17, 'com.hammerandchisel.discord', 'Bruno', Date.parse('2026-09-15T08:37:56.159Z')],
        [7, 'com.hammerandchisel.discord', 'Bruno', Date.parse('2026-09-15T08:37:56.159Z')],
    ]);
    // En notis per id, med notisens tid och händelserna i ordning.
    const list = biome.notifications(n.rows);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].ms, Date.parse('2026-09-15T08:37:56.159Z'));
    assert.deepStrictEqual(list[0].events.map((e) => e.type), [17, 7]);
});

test('samma notis under två id räknas en gång', () => {
    const rows = biome.notificationUsage(segb2([
        notice('2026-11-03T11:24:14Z', '2026-11-03T11:24:13.092Z', 17, 'com.toyopagroup.picaboo', 'A', 'Melisa'),
        notice('2026-11-03T11:24:14Z', '2026-11-03T11:24:13.092Z', 17, 'com.toyopagroup.picaboo', 'B', 'Melisa'),
        notice('2026-11-03T11:25:00Z', '2026-11-03T11:24:59Z', 17, 'com.toyopagroup.picaboo', 'C', 'Kim'),
    ])).rows;
    const list = biome.notifications(rows);
    assert.deepStrictEqual(list.map((n) => [n.title, n.copies || 1]), [['Melisa', 2], ['Kim', 1]]);
});

test('bara local/ i strömmarna som läses; remote/ och tombstone/ är inte telefonens egna poster', () => {
    const base = 'filesystem1/private/var/mobile/Library/Biome/streams/restricted/';
    const names = [
        base + 'App.InFocus/local/766585039546128',
        base + 'App.InFocus/local/tombstone/770627608544489',
        base + 'App.InFocus/remote/0A1B2C3D/766585039546999',
        base + 'Notification.Usage/local/770626098768390',
        base + 'Notification.Usage/lock',
        base + 'ScreenTime.AppUsage/local/769681685871903',
    ];
    const keep = biome.keeper();
    assert.deepStrictEqual(names.filter(keep), [names[0], names[3]]);
    const sorted = biome.sortEntries(names.map((name) => ({ name })));
    assert.deepStrictEqual(Object.keys(sorted), ['App.InFocus', 'Notification.Usage']);
    assert.strictEqual(sorted['App.InFocus'].length, 1);
    assert.strictEqual(biome.streamOf(names[0]).startMs, Date.parse('2025-04-17T12:17:19.546Z'));
    assert.throws(() => biome.segb(Buffer.alloc(100)), /inte SEGB/);
});
