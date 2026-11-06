// Kontrollerna mot iOS-labbtelefonen: zippen väljs ensam i raden högst upp, nyckelringen hittas bredvid den,
// Härkomst bedömer filerna och kopplingen till Signal, WhatsApp och Telegram jämförs med det som står
// i facit/lab-ios-signal-whatsapp.json (förväntningar kontrollerade mellan källor) och
// facit/lab-ios-tidsstamplar.json (en labbsession med loggad ordning). Finns rapporter (UFDR) från samma
// telefon i undermappar körs samma facit mot dem, utom ctime, som rapporter inte har. Körs bara när
// labbmappen finns. Läser bara filerna.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
const { sleep } = require('./cdp');
const { expect, PROV } = require('./smoke');

const ms = (iso) => Date.parse(iso);
const iso = (t) => t == null ? 'saknas' : new Date(t).toISOString();

// Zippen och nyckelringen i labbmappen, en av varje. Namnen bär telefonens enhets-id och står därför
// inte i facit.
function labFiles(dir) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return null; }
    const one = (re) => { const m = names.filter((n) => re.test(n)); return m.length === 1 ? path.join(dir, m[0]) : null; };
    const zip = one(/_fs\.zip$/);
    const keychain = one(/_keychain\.plist$/);
    return zip && keychain ? { zip, keychain } : null;
}

// Rapporter (UFDR) från samma telefon, i labbmappens undermappar: [{ name, path }].
function labReports(dir) {
    const out = [];
    let subs;
    try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (e) { return out; }
    subs.forEach((d) => {
        fs.readdirSync(path.join(dir, d.name)).filter((n) => /\.ufdr$/i.test(n)).forEach((n) => out.push({ name: d.name, path: path.join(dir, d.name, n) }));
    });
    return out;
}

async function assess(c, name) {
    // Bildens zon, oavsett vad röktestet valde före: facit har klockslagen i texterna i den zonen.
    await c.ev(PROV, `document.getElementById('zone').value = 'file', 1`);
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && (!document.getElementById('result').classList.contains('display-none') || !document.getElementById('hits').classList.contains('display-none') || /warn|err/.test(document.getElementById('run-status').innerHTML))`, 180000, name);
    return c.ev(PROV, `(function(){
        const m = ProvenanceApp.model();
        if (!m || m.file.filename !== ${JSON.stringify(name)}) return { error: document.getElementById('run-status').innerText };
        const f = Object.fromEntries(m.factors.map(x => [x.id, { state: x.state, verdict: x.verdict || '' }]));
        const cam = m.factors.find(x => x.id === 'camera');
        const time = m.factors.find(x => x.id === 'time');
        return { T: m.file.createdMs, type: m.type.label, factors: f, titles: Object.fromEntries(m.factors.map(x => [x.id, x.title])), versions: ProvenanceApp.meta().appVersionsText || '',
            cameraText: cam ? cam.items.map(i => i.text).join(' ') : '', timeText: time ? time.items.map(i => i.text).join(' ') : '',
            texts: Object.fromEntries(m.factors.map(x => [x.id, x.items.map(i => i.text).join(' ')])), flags: m.type.flags, summary: m.summary,
            times: time ? time.times.map(r => ({ id: r.id, ms: r.ms, isT: r.isT })) : [],
            events: m.events.filter(e => /^(sig|wa|tg)-/.test(e.kind)).map(e => ({ kind: e.kind, isFile: !!e.isFile, near: !!e.near, messageId: e.messageId, ms: e.ms, own: !!e.own, viewOnce: !!e.viewOnce, linked: !!e.linked, text: e.text })) };
    })()`);
}

function check(f, d, facit, report) {
    const tol = facit.toleranceMs;
    expect(!d.error, f.name + ': ' + d.error);
    if (f.T) expect(d.T != null && Math.abs(d.T - ms(f.T)) <= tol, 'T: ' + iso(d.T) + ', väntat ' + f.T);
    Object.keys(f.factors || {}).forEach((id) => expect(d.factors[id] && d.factors[id].state === f.factors[id], 'Faktorn ' + id + ' är ' + JSON.stringify(d.factors[id]) + ', väntat ' + f.factors[id]));
    Object.keys(f.verdicts || {}).forEach((id) => expect(d.factors[id] && d.factors[id].verdict === f.verdicts[id], 'Svaret för ' + id + ' är ' + JSON.stringify(d.factors[id] && d.factors[id].verdict) + ', väntat ' + f.verdicts[id]));
    // Meddelandet som är märkt som filens, och den möjliga kopplingen, i WhatsApp och Telegram.
    const linked = (want, kind, app) => {
        if (!want) return;
        const e = d.events.find((x) => x.kind === kind && x.isFile);
        expect(e, 'Inget ' + app + '-meddelande är märkt som filens');
        expect(e.messageId === want.messageId, app + '-meddelandet är ' + e.messageId + ', väntat ' + want.messageId);
        expect(e.own === (want.direction === 'out'), 'Riktningen i ' + app);
        expect(Math.abs(e.ms - ms(want.at)) <= tol, app + '-meddelandets tid ' + iso(e.ms) + ', väntat ' + want.at);
        if (want.viewOnce) expect(e.viewOnce, app + '-meddelandet är inte märkt för engångsvisning');
    };
    const nearby = (want, kind, app) => {
        if (!want) return;
        const e = d.events.find((x) => x.kind === kind && x.near);
        expect(e && e.messageId === want.messageId, 'Den möjliga kopplingen i ' + app + ' är ' + (e ? e.messageId : 'ingen') + ', väntat ' + want.messageId);
        expect(Math.abs(e.ms - d.T - want.afterMs) <= tol, 'Meddelandet ' + (e.ms - d.T) + ' ms efter T, väntat ' + want.afterMs);
    };
    linked(f.signal, 'sig-message', 'Signal');
    linked(f.whatsapp, 'wa-message', 'WhatsApp');
    linked(f.telegram, 'tg-message', 'Telegram');
    nearby(f.nearby, 'wa-message', 'WhatsApp');
    nearby(f.telegramNearby, 'tg-message', 'Telegram');
    if (f.whatsappAll) expect(JSON.stringify(d.events.filter((x) => x.kind === 'wa-message' && x.isFile).map((x) => x.messageId).sort((a, b) => a - b)) === JSON.stringify(f.whatsappAll), 'WhatsApp-meddelandena märkta som filens: ' + JSON.stringify(d.events.filter((x) => x.kind === 'wa-message' && x.isFile).map((x) => x.messageId)));
    if (f.cameraTitle) expect(d.titles.camera === f.cameraTitle, 'Kamerafaktorn heter ' + d.titles.camera + ', väntat ' + f.cameraTitle);
    if (f.cameraText) expect(new RegExp(f.cameraText).test(d.cameraText), 'Kamerafaktorn säger: ' + d.cameraText);
    // Faktorernas text, händelserna i fönstret och flaggorna.
    Object.keys(f.texts || {}).forEach((id) => expect(new RegExp(f.texts[id]).test(d.texts[id] || ''), 'Faktorn ' + id + ' säger: ' + d.texts[id]));
    (f.events || []).forEach((re) => expect(d.events.some((e) => new RegExp(re).test(e.kind + ' ' + e.text)), 'Ingen händelse matchar ' + re + ': ' + d.events.map((e) => e.kind + ' ' + e.text).join(' | ')));
    (f.flags || []).forEach((x) => expect(d.flags.includes(x), 'Flaggorna: ' + d.flags));
    if (f.timeText) expect(new RegExp(f.timeText).test(d.timeText), 'Skapandetiden säger: ' + d.timeText);
    // Tabellen över filens tider, och sammanvägningen.
    Object.keys(f.times || {}).forEach((id) => {
        if (report && id === 'fs-changed') return;
        const r = d.times.find((x) => x.id === id);
        expect(r && r.ms != null && Math.abs(r.ms - ms(f.times[id])) <= tol, 'Raden ' + id + ' i tabellen är ' + (r ? iso(r.ms) : 'borta') + ', väntat ' + f.times[id]);
    });
    if (f.summary) expect(new RegExp(f.summary).test(d.summary), 'Sammanvägningen säger: ' + d.summary);
    if (f.typeLabel) expect(d.type === f.typeLabel, 'Typen är ' + d.type);
    (facit.versions || []).forEach((v) => expect(d.versions.includes(v), 'Appversionen ' + v + ' saknas i protokollet: ' + d.versions));
    return 'T ' + (d.T ? iso(d.T).slice(11, 23) + 'Z' : '–');
}

// Bedömer raden med exakt det filnamnet, också när fler rader har samma originalnamn.
async function assessRow(c, name, zone) {
    // Som när användaren väljer zonen: utan händelsen väljer Härkomst bildens zon igen.
    await c.ev(PROV, `(function(){ const s = document.getElementById('zone'); if (s.value !== ${JSON.stringify(zone || 'file')}) { s.value = ${JSON.stringify(zone || 'file')}; s.dispatchEvent(new Event('change', { bubbles: true })); } return 1; })()`);
    await sleep(200);
    await c.waitFor(PROV, `!ProvenanceApp.busy()`, 300000, 'zonbytet');
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && (!document.getElementById('result').classList.contains('display-none') || !document.getElementById('hits').classList.contains('display-none'))`, 300000, name);
    await c.ev(PROV, `(function(){ const h = document.getElementById('hits'); if (h.classList.contains('display-none')) return; const r = [...h.querySelectorAll('tr.pick')].find(x => x.children[1] && x.children[1].textContent === ${JSON.stringify(name)}); if (r) r.click(); })()`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && ProvenanceApp.model() && ProvenanceApp.model().file.filename === ${JSON.stringify(name)}`, 300000, name);
    return c.ev(PROV, `(function(){ const f = ProvenanceApp.model().factors.find(x => x.id === 'time'); return { zone: ProvenanceApp.meta().zoneLabel, state: f.state, verdict: f.verdict, summary: ProvenanceApp.model().summary, rows: f.times.map(r => ({ id: r.id, ms: r.ms, isT: r.isT, note: r.note, absent: r.absent })) }; })()`);
}

// Varje rad i bildbiblioteket mot ett fristående facit: time-facit.py läser zippens fält, EXIF, QuickTime och
// Photos.sqlite utan programmets kod och utan ExifTool, och här jämförs det med tabellen i Härkomst.
// report: rapporten är öppen i stället för zippen. 'ctime': rapporten har ctime och avrundar till ms med en tiondels
// mikrosekund emellan (…499 950 ns blir uppåt), så där räcker inte en exakt jämförelse.
function timeFacit(zip, report) {
    const noCtime = report && report !== 'ctime';
    const fsTol = report === 'ctime' ? 1 : 0;
    return ['Filens tider i tabellen stämmer med ett fristående facit för varje rad i bildbiblioteket', async ({ c }) => {
        const out = path.join(os.tmpdir(), 'ft-tider-' + process.pid + '-' + Date.now());
        let truth;
        try {
            await run('python3', ['-I', path.join(__dirname, 'time-facit.py'), zip, out], { maxBuffer: 1 << 26 });
            truth = JSON.parse(fs.readFileSync(path.join(out, 'facit.json'), 'utf8'));
        } catch (err) {
            if (err && err.code === 'ENOENT') return 'python3 saknas, hoppar över';
            throw err;
        } finally {
            fs.rmSync(out, { recursive: true, force: true });
        }
        let values = 0;
        const near = (name, id, got, want, tol) => {
            values++;
            expect(got != null && Math.abs(got - want) <= tol, name + ', ' + id + ': programmet ' + iso(got) + ', facit ' + iso(want));
        };
        for (const f of truth.rows) {
            const d = await assessRow(c, f.name);
            const row = (id) => d.rows.find((r) => r.id === id);
            const T = d.rows.filter((r) => r.isT);
            expect(T.length === 1 && T[0].id === 'created', f.name + ': raden med T är ' + JSON.stringify(T.map((r) => r.id)));
            ['created', 'added', 'modified', 'trashed', 'adjusted'].forEach((id) => {
                if (f.library[id] == null) return;
                near(f.name, id, (row(id) || {}).ms, f.library[id], 1);
            });
            if (f.source === 1 || f.source === 3) expect(new RegExp('ZDATECREATEDSOURCE ' + f.source).test(row('created').note), f.name + ': ' + row('created').note);
            if (f.fs) {
                [['fs-modified', f.fs.m], ['fs-accessed', f.fs.a], ['fs-changed', noCtime ? 0 : f.fs.ctime], ['fs-created', f.fs.crtime]].forEach(([id, want]) => {
                    if (!want) return;
                    near(f.name, id, (row(id) || {}).ms, want, fsTol);
                });
                if (noCtime) expect(row('fs-changed') && row('fs-changed').absent, f.name + ': en rapport har ingen ctime, men tabellen har ' + JSON.stringify(row('fs-changed')));
            }
            // Tiden i filen på millisekunden. En tid utan zon i filen tolkas i bildens zon.
            if (f.fileTime != null) near(f.name, 'file-time', (row('file-time') || {}).ms, f.fileTime, 1);
            else expect(row('file-time') && row('file-time').absent, f.name + ': programmet har en tid i filen, men inte facit: ' + JSON.stringify(row('file-time')));
        }
        return truth.rows.length + ' rader, ' + values + ' tider';
    }];
}

// Vilken zon rapporten skrivs i får inte ändra slutsatsen eller tiderna.
function zoneChecks(names) {
    return ['Valet av tidszon ändrar varken slutsatsen om tiderna eller vad de betyder', async ({ c }) => {
        for (const name of names) {
            const base = await assessRow(c, name);
            for (const zone of ['utc', 'local']) {
                const d = await assessRow(c, name, zone);
                if (zone === 'utc') expect(d.zone === 'UTC', name + ': rapportens zon är ' + d.zone + ', väntat UTC');
                expect(d.state === base.state && d.verdict === base.verdict, name + ' i ' + zone + ': ' + d.verdict + ', annars ' + base.verdict);
                expect(JSON.stringify(d.rows.map((r) => [r.id, r.ms])) === JSON.stringify(base.rows.map((r) => [r.id, r.ms])), name + ' i ' + zone + ': tiderna flyttades');
            }
        }
        await assessRow(c, names[0]);
        return names.length + ' filer i tre zoner';
    }];
}

// report: rapporten som öppnas i stället för zippen. Nyckelringen väljs inte: den ska läsas ur rapporten.
function scenarios(dir, facit, report) {
    const { zip, keychain } = labFiles(dir);
    const zipName = path.basename(report || zip);
    const picked = report ? [report] : [zip];
    const stats = () => (report ? [report] : [zip, keychain]).map((p) => { const s = fs.statSync(p); return [s.size, s.mtimeMs, s.ctimeMs].join('/'); }).join(' ');
    let before = null;
    const open = [report ? 'Rapporten öppnas ensam i Härkomst' : 'Labbzippen öppnas ensam i Härkomst, och nyckelringen hittas bredvid den', async ({ c }) => {
        before = stats();
        await c.nav('Härkomst');
        await c.setFiles(null, '#cb-input', picked);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        // Två labbmappar kan ha samma filnamn, så statusraden från den förra får inte räknas.
        await sleep(1000);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(zipName)})`, 300000, 'labbzippen');
        const note = await c.waitFor(PROV, `/Nyckeln läses ur/.test(document.getElementById('signal-key-note').textContent) && document.getElementById('signal-key-note').textContent`, 20000, 'nyckelringen');
        expect(note.includes(path.basename(keychain) + (report ? ' i rapporten' : ' bredvid zippen')), 'Nyckelns källa: ' + note);
        return report ? 'rapporten, med nyckelringen i den' : 'zippen, med nyckelringen bredvid den';
    }];
    const files = facit.files.map((f) => [f.name + ': ' + f.what, async ({ c }) => check(f, await assess(c, f.name), facit, report)]);
    const untouched = [report ? 'Rapporten är orörd' : 'Labbzippen och nyckelringen är orörda', async () => {
        expect(before && before === stats(), 'Storlek, mtime eller ctime har ändrats');
        return 'storlek, mtime och ctime';
    }];
    return [open].concat(files, [timeFacit(zip, report), zoneChecks(facit.zoneChecks || [])], [untouched]);
}

// En zip där filernas tider ligger i metadata.msgpack, inte i zippens egna fält: tabellen i Härkomst mot samma
// fristående facit. Inga loggade händelser finns för de här zipparna. Sökvägarna tas ur FT_LAB_NAMED_ZIPS.
function namedTimesScenarios(zip) {
    const open = ['Zippen öppnas i Härkomst', async ({ c }) => {
        await c.nav('Härkomst');
        await c.setFiles(null, '#cb-input', [zip]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await sleep(1000);
        const text = await c.waitFor(PROV, `!ProvenanceApp.busy() && /filernas tider ur metadata\\.msgpack/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent`, 300000, 'zippen');
        return text.slice(0, 60);
    }];
    // Telefonerna har inte Signal, så appen behöver inte nyckelringen här. Den ska ändå gå att läsa: alla poster öppnas och
    // kontrollsummorna stämmer, med samma kod som i appen. Inga värden lämnar testet.
    const keys = ['Nyckelringen under extra/ öppnas, med krypterade poster', async () => {
        const ROOT = path.join(__dirname, '..', '..');
        require(path.join(ROOT, 'tools', 'ios-keychain', 'lib', 'bplist.js'));
        require(path.join(ROOT, 'tools', 'ios-keychain', 'lib', 'asn1.js'));
        const core = require(path.join(ROOT, 'tools', 'db-queries', 'extraction-core.js'));
        core.use({ ZipRead: require(path.join(ROOT, 'tools', 'db-queries', 'zip.js')), AppSecrets: require(path.join(ROOT, 'tools', 'db-queries', 'app-secrets.js')) });
        const fh = await fs.promises.open(zip, 'r');
        try {
            const read = async (offset, length) => {
                const b = Buffer.alloc(length);
                const { bytesRead } = await fh.read(b, 0, length, offset);
                return new Uint8Array(b.subarray(0, bytesRead));
            };
            const out = await core.findKeys(read, (await fh.stat()).size, {});
            const k = out.secrets.find((s) => /backup_keychain_v2\.plist/.test(s.source));
            expect(k, 'Nyckelringen hittades inte under extra/: ' + out.secrets.map((s) => s.source));
            expect(!k.error && k.failed === 0 && k.items > 100, 'Nyckelringen: ' + JSON.stringify({ error: k.error, failed: k.failed, items: k.items }));
            return k.items + ' poster, inga fel';
        } finally {
            await fh.close();
        }
    }];
    return [open, timeFacit(zip), keys];
}

// En rapport ur en zip med extra/ (FT_LAB_UFED_REPORTS, med zippen efter = om den finns). Nyckelfilerna ligger högst upp i
// rapporten, utanför telefonens filsystem. Finns Signal jämförs programmets dekryptering med rapportverktygets kopia, rad
// för rad utan -wal. Finns zippen jämförs tiderna med samma fristående facit, också ctime. Inga värden lämnar testet.
function ufedReportScenarios(report, zip) {
    const ROOT = path.join(__dirname, '..', '..');
    const name = path.basename(report);
    const lib = (p) => require(path.join(ROOT, 'tools', p));
    const nodeSource = async () => {
        lib('ios-keychain/lib/bplist.js');
        lib('ios-keychain/lib/asn1.js');
        const ZipRead = lib('db-queries/zip.js');
        const UfdrRead = lib('db-queries/ufdr.js');
        const AppSecrets = lib('db-queries/app-secrets.js');
        const core = lib('db-queries/extraction-core.js');
        UfdrRead.use({ ZipRead });
        core.use({ ZipRead, AppSecrets, UfdrRead });
        const fh = await fs.promises.open(report, 'r');
        const size = (await fh.stat()).size;
        const read = async (offset, length) => {
            const b = Buffer.allocUnsafeSlow(length);
            const { bytesRead } = await fh.read(b, 0, length, offset);
            return new Uint8Array(b.buffer, b.byteOffset, bytesRead);
        };
        const opened = await UfdrRead.open(read, size, {});
        const found = await core.findKeys(opened.read, size, { report: opened.report });
        return { ZipRead, AppSecrets, fh, size, read, opened, found };
    };
    let before = null;
    let signalPart = null;
    const stats = () => { const s = fs.statSync(report); return [s.size, s.mtimeMs, s.ctimeMs].join('/'); };
    const open = ['Rapporten öppnas ensam i Härkomst', async ({ c }) => {
        before = stats();
        await c.nav('Härkomst');
        await c.setFiles(null, '#cb-input', [report]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await sleep(1000);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(name)})`, 300000, name);
        // Raden är dold när rapporten inte har Signal, och texten kan då vara kvar från förra källan.
        const note = await c.ev(PROV, `document.getElementById('signal-key-row').classList.contains('display-none') ? '' : document.getElementById('signal-key-note').textContent`);
        return note || 'ingen Signal-databas';
    }];
    const keys = ['Nyckelfilen ligger högst upp i rapporten, är ingen fil på telefonen och går att läsa', async () => {
        const s = await nodeSource();
        try {
            expect(s.opened.report.keychains.length >= 1, 'Ingen nyckelfil i rapporten');
            s.found.secrets.forEach((k) => expect(!k.error && !k.failed, k.source + ': ' + JSON.stringify({ error: k.error, failed: k.failed })));
            const phone = (await s.ZipRead.scan(s.opened.read, s.size, (n) => /^\/[^/]*keychain[^/]*\.plist$|^\/Secrets\//.test(n))).entries;
            expect(!phone.length, 'Bland telefonens filer: ' + phone.map((e) => e.name));
            return s.found.secrets.map((k) => k.source + (k.items ? ', ' + k.items + ' poster' : '')).join('; ');
        } finally { await s.fh.close(); }
    }];
    const signal = ['Signal, dekrypterad av programmet, har samma rader som rapportverktygets kopia', async () => {
        const SqlCipher = lib('db-queries/sqlcipher.js');
        const SqliteWal = lib('db-queries/wal.js');
        if (SqlCipher.use) SqlCipher.use({ ToolboxHashing: lib('hash-calculator/hashing.js') });
        const s = await nodeSource();
        try {
            const WHICH = [{ re: /org\.thoughtcrime\.securesms\/databases\/signal\.db$/, profile: 'signal', copy: 'files/Database/signal.db.decrypted' }, { re: /grdb\/signal\.sqlite$/, profile: 'signal-ios', copy: 'files/Database/signal.sqlite.decrypted' }];
            let w = null, db = null;
            for (const x of WHICH) {
                const hit = (await s.ZipRead.scan(s.opened.read, s.size, (n) => x.re.test(n))).entries[0];
                if (hit) { w = x; db = hit; break; }
            }
            if (!db) return 'ingen Signal-databas i rapporten';
            const key = s.AppSecrets.keysForProfile(s.found.secrets, w.profile);
            expect(key && key.dbKey, 'Ingen nyckel till Signal i rapporten');
            const own = await SqlCipher.openAsync((await s.ZipRead.extract(s.opened.read, db)).bytes, new Uint8Array(0), key.dbKey, w.profile, SqliteWal, {});
            expect(own.stats.cipher.badHmac === 0, 'HMAC stämde inte för ' + own.stats.cipher.badHmac + ' sidor');
            const cache = await s.ZipRead.cacheDirectory(s.read, s.size, null, null);
            const member = (await s.ZipRead.scan(cache.read, s.size, (n) => n === w.copy)).entries[0];
            if (!member) return own.stats.cipher.pages + ' sidor, HMAC stämmer, ingen kopia att jämföra med';
            const copy = (await s.ZipRead.extract(cache.read, member)).bytes;
            const SQL = await require('./fixtures').loadSql();
            const crypto = require('node:crypto');
            const tables = (bytes) => {
                const d = new SQL.Database(bytes);
                const out = {};
                d.exec("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")[0].values.forEach(([n]) => {
                    try {
                        const r = d.exec('select * from "' + n + '"');
                        const rows = r[0] ? r[0].values : [];
                        out[n] = rows.length + ':' + crypto.createHash('sha256').update(JSON.stringify(rows, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v))).digest('hex');
                    } catch (e) { out[n] = 'går inte att läsa: ' + e.message; }
                });
                d.close();
                return out;
            };
            const a = tables(own.bytes), b = tables(copy);
            const differ = Object.keys(Object.assign({}, a, b)).filter((n) => a[n] !== b[n]);
            expect(!differ.length, 'Tabeller som skiljer: ' + differ.join(', '));
            // Bilagans krypterade fil, till nästa kontroll. Bara namnet.
            if (w.profile === 'signal') {
                const d = new SQL.Database(own.bytes);
                const part = d.exec('select data_file from attachment where data_file is not null and message_id > 0 limit 1');
                d.close();
                signalPart = part.length ? path.basename(String(part[0].values[0][0])) : null;
            }
            return Object.keys(a).length + ' tabeller, ' + own.stats.cipher.pages + ' sidor';
        } finally { await s.fh.close(); }
    }];
    // Summan kan aldrig stämma, så det är raden i databasen som pekar ut filen. ExifTool kan inte tolka den, men den är läst.
    const part = ['Signals krypterade fil kopplas till sitt meddelande', async ({ c }) => {
        if (!signalPart) return 'ingen sådan fil i rapporten';
        const d = await assessRow(c, signalPart);
        const f = await c.ev(PROV, `(function(){ const m = ProvenanceApp.model(), s = m.factors.find(x => x.id === 'signal'); return { verdict: s.verdictText, items: s.items.map(i => i.text).join(' '), own: m.events.filter(e => e.kind === 'sig-message' && e.isFile).length, sha: ProvenanceApp.meta().fileEntry.sha256 }; })()`);
        expect(/^(Mottagen|Skickad) i Signal$/.test(f.verdict) && /Filen är bilagans krypterade fil hos Signal\./.test(f.items), 'Signal: ' + JSON.stringify(f));
        expect(/^[0-9a-f]{64}$/.test(f.sha), 'Filen lästes inte');
        expect(/^Filen lästes, men ExifTool kunde inte tolka innehållet/.test(d.rows.find((r) => r.id === 'file-time').absent), 'Tiden i filen: ' + JSON.stringify(d.rows.find((r) => r.id === 'file-time')));
        return f.verdict;
    }];
    const untouched = ['Rapporten är orörd', async () => {
        expect(before && before === stats(), 'Storlek, mtime eller ctime har ändrats');
        return 'storlek, mtime och ctime';
    }];
    return [open, keys, signal, part].concat(zip ? [timeFacit(zip, 'ctime')] : [], [untouched]);
}

module.exports = { scenarios, labFiles, labReports, namedTimesScenarios, ufedReportScenarios };
