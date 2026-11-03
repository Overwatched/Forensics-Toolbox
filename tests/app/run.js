#!/usr/bin/env node
// Provkörning av hela appen i Electron: `npm run test:app`.
//
// Startar appen utan skärm (tests/app/harness.js), styr den över DevTools-protokollet och kör
// röktestet (smoke.js) mot påhittade data. Finns labbzippen kör den också facit-testerna
// (facit.js), som jämför Härkomsts tider med det som loggades på labbtelefonen. Labbzippen ligger
// inte i repot; sökvägen tas ur FT_LAB_ZIP, annars ~/Documents/Exampleextractions/.
//
//   npm run test:app                röktestet, och facit om labbzippen finns
//   npm run test:app -- --smoke     bara röktestet
//   npm run test:app -- --facit     bara facit (kräver labbzippen)
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
const onlyFacit = args.includes('--facit');

function labZip() {
    const p = process.env.FT_LAB_ZIP || path.join(os.homedir(), 'Documents', 'Exampleextractions', 'Lab-Android-Nord-2026-11-02.zip');
    return fs.existsSync(p) ? p : null;
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
    if (onlyFacit && !lab) {
        console.error('Labbzippen finns inte. Ange sökvägen i FT_LAB_ZIP.');
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
        if (!onlySmoke && lab) groups.push(['Facit mot labbtelefonen', require('./facit').scenarios(lab)]);
        if (!onlySmoke && !lab) console.log('Facit: labbzippen finns inte, hoppar över (FT_LAB_ZIP).\n');
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
