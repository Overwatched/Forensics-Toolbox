#!/usr/bin/env node
// Provkörning av html-versionen: `npm run test:html`.
//
// Packar samma filer som html-zippen (utan kartorna), öppnar Toolbox.html under file:// i en riktig
// webbläsare utan Electrons brygga och utan internet, och kör röktestet (smoke.js). Sedan öppnas samma
// sida utan WebAssembly, som när JIT är blockerad i Edge, och beskeden kontrolleras.
//
//   --browser edge|chrome|<sökväg>   annars FT_BROWSER, annars Edge eller Chrome, det som finns
//   --expect-blocked                 kontrollerar att en policy spärrar andra adresser (CI, låst Edge)
//   FT_SHOTS=<mapp>                  skärmdumpar efter varje del
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const { connect, sleep } = require('./cdp');
const fixtures = require('./fixtures');
const smoke = require('./smoke');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const PORT = Number(process.env.FT_PORT || 9231);
const QUER = smoke.QUER;
const PROV = smoke.PROV;
const EXIF = 'exif-viewer/index.html';

const PLACES = {
    edge: {
        win32: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
        darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
        linux: ['/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'],
    },
    chrome: {
        win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
        darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    },
};

function findBrowser() {
    const at = args.indexOf('--browser');
    const wanted = at >= 0 ? args[at + 1] : process.env.FT_BROWSER;
    if (wanted && !PLACES[wanted]) return wanted;
    for (const name of wanted ? [wanted] : ['edge', 'chrome']) {
        const hit = (PLACES[name][process.platform] || []).find((p) => fs.existsSync(p));
        if (hit) return hit;
    }
    return null;
}

function expect(ok, msg) { if (!ok) throw new Error(msg); }

// En proxy som inte finns: inget når internet, som på en dator med bara lokala filer och intranät.
function startBrowser(bin, url, port, flags) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-html-profil-'));
    const child = spawn(bin, [
        '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run',
        '--no-default-browser-check', '--disable-extensions', '--window-size=1600,1000', '--proxy-server=127.0.0.1:9',
    ].concat(flags || []).concat([url]), { stdio: 'ignore' });
    return { child, profile };
}

async function stopBrowser(b) {
    b.child.kill();
    await sleep(800);
    try { fs.rmSync(b.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { /* Windows kan hålla kvar filer en stund */ }
}

async function open(port, url) {
    const c = await connect(port);
    await c.send('Page.navigate', { url });
    await sleep(800);
    await c.waitFor(null, `document.querySelectorAll('.nav-item').length > 0`, 30000, 'huvudfönstret');
    return c;
}

const fileFetch = (e) => e.kind === 'log' && /catalog\.json|package\.json|CORS/.test(e.text);

// Utan WebAssembly ska det stå vad som är fel och vad som går att göra, direkt och i varje verktyg.
const noWasmScenarios = [
    ['Beskedet syns i huvudfönstret direkt', async ({ c }) => {
        expect(await c.ev(null, 'typeof WebAssembly') === 'undefined', 'Provet kräver en webbläsare utan WebAssembly');
        const text = await c.ev(null, `(function(){ const n = document.getElementById('browser-notice'); return n && !n.hidden ? n.innerText : ''; })()`);
        expect(/WebAssembly är avstängt/.test(text) && /edge:\/\/policy/.test(text), 'Beskedet i huvudfönstret: ' + text);
    }],
    ['EXIF & karta säger varför i stället för att stå och starta', async ({ c }) => {
        await c.nav('EXIF & karta');
        const status = await c.waitFor(EXIF, `document.getElementById('engine-status') && /WebAssembly/.test(document.getElementById('engine-status').textContent) && document.getElementById('engine-status').textContent`, 15000, 'beskedet i EXIF & karta');
        expect(/WebAssembly är avstängt/.test(status), 'EXIF & karta: ' + status);
    }],
    ['Queries och Härkomst säger varför när något ska läsas', async ({ c, fx }) => {
        await c.nav('Queries');
        await c.waitFor(QUER, 'window.QueriesApp && QueriesApp.databases().length', 30000, 'katalogen');
        await c.setFiles(null, '#cb-input', [fx.files.zip]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'zippen i Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="knowledgec"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); document.querySelector('.side-q[data-db="knowledgec"][data-q="app-usage"]').click(); return 1; })()`);
        await sleep(300);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        const q = await c.waitFor(QUER, `/WebAssembly/.test(document.getElementById('run-status').textContent) && document.getElementById('run-status').textContent`, 15000, 'beskedet i Queries');
        expect(/WebAssembly är avstängt/.test(q), 'Queries: ' + q);
        await c.nav('Härkomst');
        await sleep(500);
        await c.ev(PROV, `(function(){ const b = document.getElementById('ex-follow-btn'); if (b && !document.getElementById('ex-follow').classList.contains('display-none')) b.click(); return 1; })()`);
        await c.waitFor(PROV, `/databaser hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'zippen i Härkomst');
        await c.ev(PROV, `document.getElementById('filename').value = '${fx.imageName}', document.getElementById('run').click(), 1`);
        const p = await c.waitFor(PROV, `/WebAssembly/.test(document.getElementById('run-status').textContent) && document.getElementById('run-status').textContent`, 15000, 'beskedet i Härkomst');
        expect(/WebAssembly är avstängt/.test(p), 'Härkomst: ' + p);
    }],
];

async function runGroup(c, title, list, ctx, shots, counter) {
    console.log(title);
    for (const [name, fn] of list) {
        counter.ran++;
        const t0 = Date.now();
        const before = c.errors.length;
        try {
            const note = await fn(Object.assign({ c }, ctx));
            const errs = c.errors.slice(before).filter((e) => e.kind === 'exception');
            if (errs.length) throw new Error('Fel i sidan: ' + errs.map((e) => e.text.split('\n')[0]).join(' | '));
            console.log('  ✔ ' + name + (note ? ' (' + note + ')' : '') + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
        } catch (err) {
            counter.failed++;
            console.log('  ✖ ' + name + '\n      ' + String(err && err.message || err).split('\n').join('\n      '));
        }
        if (shots) await c.shot(path.join(shots, String(counter.ran).padStart(2, '0') + '.png')).catch(() => {});
    }
    console.log('');
}

async function main() {
    if (typeof WebSocket === 'undefined') {
        console.error('Provkörningen kräver Node 22 eller senare (inbyggd WebSocket). Den här är ' + process.version + '.');
        process.exit(1);
    }
    const bin = findBrowser();
    if (!bin) {
        console.error('Hittar ingen webbläsare. Ange --browser edge|chrome|<sökväg> eller FT_BROWSER.');
        process.exit(1);
    }
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-html-'));
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'pack-html-folder.js'), '--folder', folder], { stdio: 'ignore' });
    const url = pathToFileURL(path.join(folder, 'Toolbox.html')).href;
    const fx = await fixtures.build();
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-html-nedladdningar-'));
    const shots = process.env.FT_SHOTS || null;
    const counter = { ran: 0, failed: 0 };
    console.log('Webbläsare: ' + bin);

    let browser = startBrowser(bin, url, PORT);
    try {
        const c = await open(PORT, url);
        await c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
        console.log(await c.ev(null, 'navigator.userAgent') + '\n');
        await runGroup(c, 'Röktest under file://, utan internet', smoke.scenarios, { fx, downloads }, shots, counter);
        const blocked = c.errors.filter(fileFetch);
        if (blocked.length) {
            counter.failed++;
            console.log('✖ Blockerade hämtningar i konsolen: ' + blocked.length + '\n  ' + blocked.slice(0, 3).map((e) => String(e.text).slice(0, 160)).join('\n  ') + '\n');
        }
        const others = c.errors.filter((e) => e.kind !== 'exception' && !fileFetch(e));
        if (others.length) console.log('Andra fel i konsolen (räknas inte som misslyckade): ' + others.length + '\n  ' + others.slice(0, 5).map((e) => String(e.text).slice(0, 160)).join('\n  ') + '\n');
        // Spärrar policyn inte, så provar körningen inte det den säger.
        if (args.includes('--expect-blocked')) {
            const nav = await c.send('Page.navigate', { url: 'http://intranat.invalid/' });
            const text = nav.result && nav.result.errorText || '';
            console.log('Policyn: ' + (text || 'adressen öppnades'));
            if (!/BLOCKED_BY_ADMINISTRATOR/.test(text)) { counter.failed++; console.log('✖ Policyn spärrar inte andra adresser'); }
        }
        c.close();
    } catch (err) {
        counter.failed++;
        console.log('✖ Provkörningen kunde inte köras: ' + (err && err.message || err));
    }
    await stopBrowser(browser);

    browser = startBrowser(bin, url, PORT + 1, ['--js-flags=--jitless']);
    try {
        const c = await open(PORT + 1, url);
        await runGroup(c, 'Utan WebAssembly (JIT blockerad)', noWasmScenarios, { fx, downloads }, shots, counter);
        c.close();
    } catch (err) {
        counter.failed++;
        console.log('✖ Provkörningen utan WebAssembly kunde inte köras: ' + (err && err.message || err));
    }
    await stopBrowser(browser);

    fs.rmSync(fx.files.dir, { recursive: true, force: true });
    fs.rmSync(downloads, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
    console.log(counter.failed ? '✖ ' + counter.failed + ' misslyckades av ' + counter.ran : '✔ alla ' + counter.ran + ' gick igenom');
    process.exit(counter.failed ? 1 : 0);
}

main();
