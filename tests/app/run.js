#!/usr/bin/env node
// Provkörning av hela appen i Electron: `npm run test:app`.
//
// Startar appen utan skärm (tests/app/harness.js), styr den över DevTools-protokollet och kör
// röktestet (smoke.js) mot påhittade data. Finns labbzipparna kör den också facit-testerna
// (facit.js), som jämför Härkomsts tider med det som loggades på Android-labbtelefonen, och
// kontrollerna mot iOS-labbtelefonen (lab-ios.js). Labbzipparna ligger inte i repot; sökvägarna
// tas ur FT_LAB_ZIP, FT_LAB_IOS_DIR och FT_LAB_IOS_LOG_DIR, annars ~/Documents/Exampleextractions/. Zippar med
// metadata.msgpack kontrolleras mot det fristående facit om sökvägarna står i FT_LAB_NAMED_ZIPS (åtskilda med kolon).
// Rapporter ur en sådan zip kontrolleras om de står i FT_LAB_UFED_REPORTS, med zippen efter = om den finns.
// Samsungs loggar kontrolleras mot rapporten i FT_LAB_SAMSUNG_REPORT.
//
//   npm run test:app                röktestet, och labbtesterna om labbzipparna finns
//   npm run test:app -- --smoke     bara röktestet
//   npm run test:app -- --facit     bara labbtesterna (kräver minst en labbzipp)
//   npm run test:app -- --samsung   bara Samsungs loggar (kräver FT_LAB_SAMSUNG_REPORT)
//   FT_SHOTS=<mapp>                 skärmdumpar efter varje del
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { connect, sleep } = require('./cdp');
const fixtures = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.FT_PORT || 9223);
const args = process.argv.slice(2);
const onlySmoke = args.includes('--smoke');
const onlySamsung = args.includes('--samsung');
const onlyFacit = args.includes('--facit') || onlySamsung;

function labZip() {
    const p = process.env.FT_LAB_ZIP || path.join(os.homedir(), 'Documents', 'Exampleextractions', 'Lab-Android-Nord-2026-11-02.zip');
    return fs.existsSync(p) ? p : null;
}

function labIosDir(facit, envName) {
    const d = process.env[envName] || path.join(os.homedir(), 'Documents', 'Exampleextractions', facit.dir);
    return require('./lab-ios').labFiles(d) ? d : null;
}

function startApp(downloads) {
    const electron = require('electron');
    const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    const env = Object.assign({}, process.env, { FT_PORT: String(PORT), FT_DOWNLOADS: downloads });
    delete env.ELECTRON_RUN_AS_NODE;
    const flags = headless ? ['--ozone-platform=headless'] : [];
    if (process.env.CI) flags.push('--no-sandbox');
    const child = spawn(electron, flags.concat([path.join(__dirname, 'harness.js')]), { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    child.lastErr = () => stderr;
    return child;
}

async function main() {
    if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
        console.error('Provkörningen kräver Node 22 eller senare (inbyggd WebSocket). Den här är ' + process.version + '.');
        process.exit(1);
    }
    const lab = labZip();
    const iosFacit = require('./facit/lab-ios-signal-whatsapp.json');
    const logFacit = require('./facit/lab-ios-tidsstamplar.json');
    const labIos = labIosDir(iosFacit, 'FT_LAB_IOS_DIR');
    const labIosLog = labIosDir(logFacit, 'FT_LAB_IOS_LOG_DIR');
    const namedZips = (process.env.FT_LAB_NAMED_ZIPS || '').split(path.delimiter).filter((p) => p && fs.existsSync(p));
    const ufedReports = (process.env.FT_LAB_UFED_REPORTS || '').split(path.delimiter).map((p) => p.split('=')).filter(([r]) => r && fs.existsSync(r));
    const samsungReport = process.env.FT_LAB_SAMSUNG_REPORT && fs.existsSync(process.env.FT_LAB_SAMSUNG_REPORT) ? process.env.FT_LAB_SAMSUNG_REPORT : null;
    if (onlyFacit && !lab && !labIos && !labIosLog && !namedZips.length && !ufedReports.length && !samsungReport) {
        console.error('Labbzipparna finns inte. Ange sökvägarna i FT_LAB_ZIP, FT_LAB_IOS_DIR och FT_LAB_IOS_LOG_DIR.');
        process.exit(1);
    }
    const fx = await fixtures.build();
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nedladdningar-'));
    const child = startApp(downloads);
    let failed = 0;
    let ran = 0;
    const shots = process.env.FT_SHOTS || null;
    try {
        const c = await connect(PORT);
        await c.waitFor(null, `document.querySelectorAll('.nav-item').length > 0`, 30000, 'huvudfönstret');
        const groups = [];
        if (!onlyFacit) groups.push(['Röktest', require('./smoke').scenarios]);
        if (!onlySmoke && lab) groups.push(['Facit mot Android-labbtelefonen', require('./facit').scenarios(lab)]);
        if (!onlySmoke && !lab) console.log('Facit: Android-labbzippen finns inte, hoppar över (FT_LAB_ZIP).\n');
        if (!onlySmoke && labIos) groups.push(['Kontroller mot iOS-labbtelefonen', require('./lab-ios').scenarios(labIos, iosFacit)]);
        if (!onlySmoke && !labIos) console.log('iOS-labbtelefonen: mappen finns inte, hoppar över (FT_LAB_IOS_DIR).\n');
        if (!onlySmoke && labIosLog) groups.push(['Facit mot iOS-labbtelefonen (loggad session)', require('./lab-ios').scenarios(labIosLog, logFacit)]);
        if (!onlySmoke && labIosLog) require('./lab-ios').labReports(labIosLog).forEach((r) => groups.push(['Samma facit mot rapporten i ' + r.name, require('./lab-ios').scenarios(labIosLog, logFacit, r.path)]));
        if (!onlySmoke && !labIosLog) console.log('iOS-labbtelefonen, loggad session: mappen finns inte, hoppar över (FT_LAB_IOS_LOG_DIR).\n');
        if (!onlySmoke) namedZips.forEach((z, i) => groups.push(['Tiderna ur metadata.msgpack, zipp ' + (i + 1), require('./lab-ios').namedTimesScenarios(z)]));
        if (!onlySmoke) ufedReports.forEach(([r, z], i) => groups.push(['Rapport ur en zip med extra/, nummer ' + (i + 1), require('./lab-ios').ufedReportScenarios(r, z)]));
        if (!onlySmoke && samsungReport) groups.push(['Samsungs loggar mot rapporten', require('./lab-samsung').scenarios(samsungReport)]);
        if (onlySamsung) groups.splice(0, groups.length - 1);
        for (const [group, list] of groups) {
            console.log(group);
            for (const [name, fn] of list) {
                ran++;
                const t0 = Date.now();
                const before = c.errors.length;
                try {
                    const note = await fn({ c, fx, downloads });
                    const errs = c.errors.slice(before).filter((e) => e.kind === 'exception');
                    if (errs.length) throw new Error('Fel i sidan: ' + errs.map((e) => e.text.split('\n')[0]).join(' | '));
                    console.log('  ✔ ' + name + (note ? ' (' + note + ')' : '') + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
                } catch (err) {
                    failed++;
                    console.log('  ✖ ' + name + '\n      ' + String(err && err.message || err).split('\n').join('\n      '));
                }
                if (shots) await c.shot(path.join(shots, String(ran).padStart(2, '0') + '.png')).catch(() => {});
            }
            console.log('');
        }
        const pageErrors = c.errors.filter((e) => e.kind === 'console.error');
        if (pageErrors.length) console.log('Fel i konsolen (räknas inte som misslyckade): ' + pageErrors.length + '\n  ' + pageErrors.slice(0, 5).map((e) => String(e.text).slice(0, 160)).join('\n  ') + '\n');
        c.close();
    } catch (err) {
        failed++;
        console.log('✖ Provkörningen kunde inte köras: ' + (err && err.message || err));
        console.log(child.lastErr());
    } finally {
        child.kill();
        await sleep(300);
        fs.rmSync(fx.files.dir, { recursive: true, force: true });
        fs.rmSync(downloads, { recursive: true, force: true });
    }
    console.log((failed ? '✖ ' + failed + ' av ' + ran + ' misslyckades' : '✔ alla ' + ran + ' gick igenom'));
    process.exit(failed ? 1 : 0);
}

main();
