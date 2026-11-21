// Webbhistorik (queries/web): katalogen mot labbtelefonernas scheman, rollerna genom Web, söktermerna, flikarnas tid
// ur plisten och webbläsaren efter sökvägen. Inga data ur telefonerna: bara tabellernas CREATE TABLE och egna rader.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const catalog = require(path.join(ROOT, 'queries', 'web', 'catalog.json'));
const SCHEMAS = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'web-schemas.json'));
const Web = require('./web.js');
const Roles = require('../provenance/roles.js');
require(path.join(ROOT, 'tools', 'ios-keychain', 'lib', 'bplist.js'));
const parsePlist = globalThis.KC.bplist.parse;

let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}
// NOT NULL tas bort så att testets rader bara behöver kolumnerna som frågorna läser.
async function dbFor(key) {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS[key]).forEach((sql) => db.run(sql.replace(/(?<!IS )NOT NULL/gi, '')));
    return db;
}
const SCHEMA_OF = { 'ios-safari-history': 'ios-safari-history', 'ios-safari-tabs': 'ios-safari-tabs', 'ios-safari-bookmarks': 'ios-safari-bookmarks', 'android-chrome': 'android-chrome', 'android-sbrowser': 'android-sbrowser', 'ios-chrome': 'android-chrome', 'android-gecko': 'android-gecko' };
const srcOf = (id) => Web.sources(catalog).find((s) => s.key === id);
function exec(db, q, values) {
    const r = db.exec(Roles.fill(q.sql, values || {}));
    return r.length ? r[r.length - 1] : { columns: [], values: [] };
}
function insert(db, table, row) {
    const cols = Object.keys(row);
    db.run('INSERT INTO "' + table + '" (' + cols.map((c) => '"' + c + '"').join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')', cols.map((c) => row[c]));
}
const COCOA = 978307200;
const cocoa = (iso) => Date.parse(iso) / 1000 - COCOA;
const webkit = (iso) => (Date.parse(iso) + 11644473600000) * 1000;

// En binär plist med en ordbok { LastVisitTime: datum }, som Safaris local_attributes.
function plistWithDate(iso) {
    const key = Buffer.from('LastVisitTime');
    const date = Buffer.alloc(9); date[0] = 0x33; date.writeDoubleBE(cocoa(iso), 1);
    const objects = [Buffer.from([0xd1, 1, 2]), Buffer.concat([Buffer.from([0x50 | key.length]), key]), date];
    const head = Buffer.from('bplist00');
    const offsets = []; let at = head.length;
    objects.forEach((o) => { offsets.push(at); at += o.length; });
    const trailer = Buffer.alloc(32);
    trailer[6] = 1; trailer[7] = 1;
    trailer.writeBigUInt64BE(BigInt(objects.length), 8); trailer.writeBigUInt64BE(0n, 16); trailer.writeBigUInt64BE(BigInt(at), 24);
    return new Uint8Array(Buffer.concat([head, ...objects, Buffer.from(offsets), trailer]));
}

test('katalogen: sju databaser, varje query går att förbereda mot labbtelefonernas scheman, och rollerna har sina fält', async () => {
    assert.deepStrictEqual(catalog.databases.map((d) => d.id), ['ios-safari-history', 'ios-safari-tabs', 'ios-safari-bookmarks', 'android-chrome', 'android-sbrowser', 'ios-chrome', 'android-gecko']);
    const errors = [];
    for (const d of catalog.databases) {
        const db = await dbFor(SCHEMA_OF[d.id]);
        for (const q of d.queries) {
            const sql = q.sql.replace(/\{\{cocoa(Start|End)\}\}/g, '0').replace(/\{\{unixMs(Start|End)\}\}/g, '0');
            try {
                const r = db.exec(sql);
                if (q.hidden) {
                    const cols = r.length ? r[0].columns : db.prepare(sql).getColumnNames();
                    Object.entries(q.fields).forEach(([k, c]) => { if (!cols.includes(c)) errors.push(d.id + '/' + q.id + ': fältet ' + k + ' (' + c + ') saknas'); });
                }
            } catch (e) { errors.push(d.id + '/' + q.id + ': ' + e.message); }
        }
        db.close();
    }
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(Web.sources(catalog).map((s) => s.key + ':' + Object.keys(s.roles).join(',')),
        ['ios-safari-history:visits,searches,cleared', 'ios-safari-tabs:tabs', 'android-chrome:visits,searches,downloads', 'android-sbrowser:visits,searches,downloads', 'ios-chrome:visits,searches,downloads', 'android-gecko:visits,bookmarks']);
});

test('Safari: besöken med ursprung och omdirigering, söktermerna ur adressen och den rensade historiken', async () => {
    const db = await dbFor('ios-safari-history');
    insert(db, 'history_items', { id: 1, url: 'https://www.google.com/search?q=t%C3%A5gtider+g%C3%B6teborg&client=safari', domain_expansion: 'google', visit_count: 1 });
    insert(db, 'history_items', { id: 2, url: 'http://example.org/', visit_count: 1 });
    insert(db, 'history_items', { id: 3, url: 'https://www.example.org/', visit_count: 2 });
    insert(db, 'history_items', { id: 4, url: 'https://duckduckgo.com/?q=v%C3%A4der%20%E2%98%80&t=h_', visit_count: 1 });
    insert(db, 'history_visits', { id: 10, history_item: 1, visit_time: cocoa('2026-11-03T09:00:00Z'), title: 'tågtider göteborg - Google Sök', load_successful: 1, origin: 0 });
    insert(db, 'history_visits', { id: 11, history_item: 2, visit_time: cocoa('2026-11-03T09:01:00Z'), title: '', load_successful: 0, origin: 0, redirect_destination: 12 });
    insert(db, 'history_visits', { id: 12, history_item: 3, visit_time: cocoa('2026-11-03T09:01:00.5Z'), title: 'Exempel', load_successful: 1, origin: 0, redirect_source: 11 });
    insert(db, 'history_visits', { id: 13, history_item: 3, visit_time: cocoa('2026-11-02T20:00:00Z'), title: 'Exempel', load_successful: 1, origin: 1 });
    insert(db, 'history_visits', { id: 14, history_item: 4, visit_time: cocoa('2026-11-03T10:00:00Z'), title: 'väder', load_successful: 1, origin: 0 });
    insert(db, 'history_tombstones', { id: 1, start_time: cocoa('2026-11-01T00:00:00Z'), end_time: cocoa('2026-11-01T23:59:59Z'), url: null, generation: 3 });
    const src = srcOf('ios-safari-history');
    const v = Web.visits(src, exec(db, src.roles.visits));
    assert.deepStrictEqual(v.map((x) => x.id), ['14', '12', '11', '10', '13']);
    const red = v.find((x) => x.id === '12');
    assert.strictEqual(red.redirectFrom, 'http://example.org/');
    assert.strictEqual(red.host, 'example.org');
    assert.strictEqual(red.ms, Date.parse('2026-11-03T09:01:00.5Z'));
    assert.strictEqual(v.find((x) => x.id === '13').originText, 'Annan enhet (synkad)');
    assert.strictEqual(v.find((x) => x.id === '11').loaded, 0);
    const s = Web.searches(src, exec(db, src.roles.searches));
    assert.deepStrictEqual(s.map((x) => [x.term, x.engine, new Date(x.ms).toISOString()]), [['väder ☀', 'DuckDuckGo', '2026-11-03T10:00:00.000Z'], ['tågtider göteborg', 'Google', '2026-11-03T09:00:00.000Z']]);
    // I Queries avkodas de vanligaste tecknen i SQL:en.
    const q = catalog.databases[0].queries.find((x) => x.id === 'safari-searches');
    const r = exec(db, q);
    assert.deepStrictEqual(r.values.map((row) => row[r.columns.indexOf('sokterm')]), ['tågtider göteborg', 'väder %E2%98%80']);
    const c = Web.cleared(src, exec(db, src.roles.cleared));
    assert.strictEqual(c.length, 1);
    assert.strictEqual(c[0].url, '');
    assert.strictEqual(c[0].endMs, Date.parse('2026-11-01T23:59:59Z'));
    // Tidsspannet i Queries.
    const visitsQ = catalog.databases[0].queries.find((x) => x.id === 'safari-visits');
    assert.strictEqual(exec(db, visitsQ, { window: { startMs: Date.parse('2026-11-03T00:00:00Z'), endMs: Date.parse('2026-11-03T09:30:00Z') } }).values.length, 3);
    db.close();
});

test('Safari: flikarna i vanliga, privata och egna grupper, med tiden ur local_attributes', async () => {
    const db = await dbFor('ios-safari-tabs');
    insert(db, 'windows', { id: 1, local_tab_group_id: 2, private_tab_group_id: 3, uuid: 'W' });
    insert(db, 'bookmarks', { id: 2, parent: 0, type: 1, title: '', hidden: 1, subtype: 0 });
    insert(db, 'bookmarks', { id: 3, parent: 0, type: 1, title: '', hidden: 1, subtype: 0 });
    insert(db, 'bookmarks', { id: 4, parent: 0, type: 1, title: 'Resor', hidden: 0, subtype: 0 });
    insert(db, 'bookmarks', { id: 10, parent: 2, type: 0, title: 'Nyheter', url: 'https://www.example.org/nyheter', order_index: 0, local_attributes: plistWithDate('2026-11-03T08:00:00Z') });
    insert(db, 'bookmarks', { id: 11, parent: 3, type: 0, title: 'Hemlig', url: 'https://private.example/', order_index: 0, local_attributes: plistWithDate('2026-11-03T08:30:00Z') });
    insert(db, 'bookmarks', { id: 12, parent: 4, type: 0, title: 'Tåg', url: 'https://www.sj.se/', order_index: 0 });
    const src = srcOf('ios-safari-tabs');
    const t = Web.tabs(src, exec(db, src.roles.tabs), parsePlist);
    assert.deepStrictEqual(t.map((x) => [x.title, x.group, x.private, x.ms && new Date(x.ms).toISOString()]),
        [['Nyheter', 'Flikar', false, '2026-11-03T08:00:00.000Z'], ['Tåg', 'Resor', false, null], ['Hemlig', 'Privata flikar', true, '2026-11-03T08:30:00.000Z']]);
    const groups = exec(db, catalog.databases[1].queries.find((x) => x.id === 'safari-tab-groups'));
    assert.deepStrictEqual(groups.values.map((r) => r[groups.columns.indexOf('slag')] + ' ' + r[groups.columns.indexOf('flikar')]), ['vanliga flikar 1', 'privata flikar 1', 'flikgrupp 1']);
    db.close();
});

test('Chrome: besöken med övergång och tid på sidan, söktermerna och nedladdningen med adresskedjan', async () => {
    const db = await dbFor('android-chrome');
    insert(db, 'urls', { id: 1, url: 'https://www.google.com/search?q=pdf+exempel', title: 'pdf exempel - Google Sök', visit_count: 1, typed_count: 0, last_visit_time: webkit('2026-11-03T09:00:00Z'), hidden: 0 });
    insert(db, 'urls', { id: 2, url: 'https://example.com/sida', title: 'Sidan', visit_count: 1, typed_count: 1, last_visit_time: webkit('2026-11-03T09:00:10Z'), hidden: 0 });
    insert(db, 'visits', { id: 1, url: 1, visit_time: webkit('2026-11-03T09:00:00Z'), from_visit: 0, transition: 5 | 0x02000000 | 0x30000000, visit_duration: 4000000, originator_cache_guid: '' });
    insert(db, 'visits', { id: 2, url: 2, visit_time: webkit('2026-11-03T09:00:10Z'), from_visit: 1, transition: 0 | 0x30000000, visit_duration: 61500000, originator_cache_guid: 'abc', app_id: '' });
    insert(db, 'keyword_search_terms', { keyword_id: 2, url_id: 1, term: 'pdf exempel', normalized_term: 'pdf exempel' });
    insert(db, 'downloads', { id: 1, guid: 'g', current_path: '/storage/emulated/0/Download/fil.pdf', target_path: '/storage/emulated/0/Download/fil.pdf', start_time: webkit('2026-11-03T09:01:00Z'),
        received_bytes: 1258291, total_bytes: 1258291, state: 1, danger_type: 0, interrupt_reason: 0, end_time: webkit('2026-11-03T09:01:02Z'), opened: 1, last_access_time: 0,
        referrer: 'https://example.com/sida', site_url: 'https://example.com/', tab_url: 'https://example.com/sida', tab_referrer_url: 'https://www.google.com/', mime_type: 'application/pdf' });
    insert(db, 'downloads_url_chains', { id: 1, chain_index: 0, url: 'https://example.com/fil.pdf' });
    insert(db, 'downloads_url_chains', { id: 1, chain_index: 1, url: 'https://cdn.example.com/fil.pdf' });
    const src = srcOf('android-chrome');
    const v = Web.visits(src, exec(db, src.roles.visits));
    assert.deepStrictEqual(v.map((x) => [x.id, x.transition, x.qualifiers, x.durationS, x.originText]),
        [['2', 'länk', '', 61.5, 'Annan enhet (synkad)'], ['1', 'sökning i adressfältet', 'adressfältet', 4, 'Den här enheten']]);
    assert.strictEqual(v[0].from, 'https://www.google.com/search?q=pdf+exempel');
    assert.strictEqual(v[0].ms, Date.parse('2026-11-03T09:00:10Z'));
    const s = Web.searches(src, exec(db, src.roles.searches));
    assert.deepStrictEqual(s.map((x) => x.term), ['pdf exempel']);
    const d = Web.downloads(src, exec(db, src.roles.downloads));
    assert.strictEqual(d.length, 1);
    assert.deepStrictEqual([d[0].name, d[0].url, d[0].chain, d[0].state, d[0].opened, d[0].referrer, Web.sizeText(d[0].size)],
        ['fil.pdf', 'https://cdn.example.com/fil.pdf', 'https://example.com/fil.pdf → https://cdn.example.com/fil.pdf', 'klar', true, 'https://example.com/sida', '1,2 MB']);
    assert.strictEqual(d[0].endMs, Date.parse('2026-11-03T09:01:02Z'));
    assert.strictEqual(d[0].lastAccessMs, null);
    insert(db, 'downloads', { id: 2, guid: 'h', current_path: 'content://media/external/downloads/24', target_path: 'content://media/external/downloads/24', start_time: webkit('2026-11-03T09:05:00Z'), state: 1 });
    insert(db, 'downloads_url_chains', { id: 2, chain_index: 0, url: 'https://f-droid.org/F-Droid.apk' });
    const d2 = Web.downloads(src, exec(db, src.roles.downloads))[0];
    assert.deepStrictEqual([d2.name, d2.mediaStore], ['F-Droid.apk', '24']);
    // Queries: tidsspannet och övergången i ord.
    const q = catalog.databases.find((x) => x.id === 'android-chrome').queries.find((x) => x.id === 'chrome-visits');
    const r = exec(db, q, { window: { startMs: Date.parse('2026-11-03T09:00:05Z'), endMs: Date.parse('2026-11-03T10:00:00Z') } });
    assert.deepStrictEqual(r.values.map((row) => [row[r.columns.indexOf('overgang')], row[r.columns.indexOf('ursprung')], row[r.columns.indexOf('sekunder_pa_sidan')]]), [['länk', 'annan enhet (synk)', 61.5]]);
    db.close();
});

test('webbläsaren efter sökvägen, värddatorn och filnamnet', () => {
    const chrome = srcOf('android-chrome'), safari = srcOf('ios-safari-history'), ios = srcOf('ios-chrome');
    assert.deepStrictEqual(Web.browserOf(chrome, 'Dump/data/data/com.android.chrome/app_chrome/Default/History'), { id: 'com.android.chrome', name: 'Chrome', platform: 'Android' });
    assert.deepStrictEqual(Web.browserOf(chrome, '/data/user/0/com.microsoft.emmx/app_chrome/Default/History'), { id: 'com.microsoft.emmx', name: 'Edge', platform: 'Android' });
    assert.strictEqual(Web.browserOf(chrome, '/data/data/org.example.browser/app_chrome/Default/History').name, 'Chrome (org.example.browser)');
    assert.deepStrictEqual(Web.browserOf(safari, '/private/var/mobile/Library/Safari/History.db'), { id: 'com.apple.mobilesafari', name: 'Safari', platform: 'iOS' });
    assert.strictEqual(Web.browserOf(ios, '/private/var/mobile/Containers/Data/Application/X/Library/Application Support/Google/Chrome/Default/History').id, 'com.google.chrome.ios');
    assert.strictEqual(Web.host('https://user@www.Example.org:8080/a?b#c'), 'example.org');
    assert.strictEqual(Web.host('about:blank'), '');
    assert.strictEqual(Web.fileName('https://example.com/dir/fil.pdf?x=1'), 'fil.pdf');
    assert.strictEqual(Web.decodeTerm('%E2%98%80+sol'), '☀ sol');
    assert.strictEqual(Web.decodeTerm('100%'), '100%');
});

test('Tor Browser (places.sqlite): bokmärket med tiden, inga besök i privat läge, och nedladdningen ur MediaStore', async () => {
    const src = srcOf('android-gecko');
    const db = await dbFor('android-gecko');
    // Som i labbet: mapparna och ett bokmärke, men inga besök.
    insert(db, 'moz_places', { id: 1, url: 'https://example.com/', title: 'Example Domain', guid: 'p1', visit_count_local: 0, typed: 0 });
    [[1, null, 'root', 'root________', null], [5, null, 'mobile', 'mobile______', 1]].forEach(([id, fk, title, guid, parent]) => insert(db, 'moz_bookmarks', { id, fk, type: 2, parent, position: 0, title, guid, dateAdded: 1795266095537, lastModified: 1795266095537 }));
    insert(db, 'moz_bookmarks', { id: 6, fk: 1, type: 1, parent: 5, position: 0, title: 'Example Domain', guid: 'b6', dateAdded: 1795266218214, lastModified: 1795266218214 });
    const b = Web.bookmarks(src, exec(db, src.roles.bookmarks));
    assert.deepStrictEqual(b.map((x) => [x.title, x.url, x.ms, x.folder]), [['Example Domain', 'https://example.com/', 1795266218214, 'Mobilens bokmärken']]);
    assert.deepStrictEqual(Web.visits(src, exec(db, src.roles.visits)), []);
    const saved = exec(db, catalog.databases.find((d) => d.id === 'android-gecko').queries.find((q) => q.id === 'gecko-saved'));
    assert.deepStrictEqual(saved.values[0].slice(0, 3), [0, 1, 1]);
    assert.match(saved.values[0][3], /privat läge/);
    // En nedladdning i MediaStore med appen som ägare och utan adress.
    const rows = [{ pk: 1000000117, path: '/storage/emulated/0/Download/a.asc.key', filename: 'a.asc.key', relativePath: 'Download/', owner: 'org.torproject.torbrowser', mime: 'application/pgp-keys', size: 833, added: 1795266297, addedMs: 1795266297000, url: null, referrer: null },
        { pk: 2, filename: 'b.pdf', owner: 'com.android.chrome', addedMs: 1 }];
    const d = Web.storeDownloads(rows, 'org.torproject.torbrowser');
    assert.deepStrictEqual(d.map((x) => [x.name, x.ms, x.url, x.mediaStore, x.fromStore]), [['a.asc.key', 1795266297000, '', '1000000117', true]]);
    assert.strictEqual(Web.browserOf(src, 'Dump/data/data/org.torproject.torbrowser/files/places.sqlite').name, 'Tor Browser');
    db.close();
});
