'use strict';
// Mäter Chattar mot den stora påhittade extraktionen (stress-extraction.js): tiden att öppna zippen och få
// listan, att öppna den långa chatten, att rulla genom den och söka i den, och minnet i appens processer.
// Ingår inte i provkörningen; körs för hand:
//
//   node tests/app/stress-extraction.js <mapp>
//   node tests/app/stress.js <mapp>/Stor-iPhone.zip
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { connect, sleep } = require('./cdp');

const PORT = 9231;
const CHAT = 'chats/index.html';

// Minnet (RSS) i appens alla processer, i MB.
function rss(pid) {
    const all = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=']).toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Set([pid]);
    let grew = true;
    while (grew) { grew = false; for (const [p, pp] of all) if (kids.has(pp) && !kids.has(p)) { kids.add(p); grew = true; } }
    return Math.round(all.filter(([p]) => kids.has(p)).reduce((s, r) => s + r[2], 0) / 1024);
}

async function main() {
    const zip = process.argv[2];
    if (!zip || !fs.existsSync(zip)) throw new Error('Ange zippen: node tests/app/stress.js <Stor-iPhone.zip>');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-profil-')), downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nedladdningar-'));
    const env = Object.assign({}, process.env, { FT_PORT: String(PORT), FT_DOWNLOADS: downloads, FT_PROFILE: profile });
    delete env.ELECTRON_RUN_AS_NODE;
    const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    const child = spawn(require('electron'), (headless ? ['--ozone-platform=headless'] : []).concat([path.join(__dirname, 'harness.js')]), { cwd: path.join(__dirname, '..', '..'), env, stdio: 'ignore' });
    const out = {};
    const time = async (label, fn) => { const t = Date.now(); const r = await fn(); out[label] = { s: +((Date.now() - t) / 1000).toFixed(2), mb: rss(child.pid) }; return r; };
    try {
        const c = await connect(PORT);
        await c.waitFor(null, `document.querySelectorAll('.nav-item').length > 0`, 30000, 'huvudfönstret');
        out.start = { mb: rss(child.pid) };
        await c.nav('Chattar');
        await c.waitFor(CHAT, `!!window.ChatsApp`, 30000, 'Chattar');
        await time('öppna zippen till listan', async () => {
            await c.setFiles(null, '#cb-input', [zip]);
            await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
            await c.waitFor(CHAT, `!ChatsApp.busy() && [...document.querySelectorAll('.c-item')].some(b => b.innerText.includes('Den långa chatten'))`, 600000, 'listan');
        });
        out.listan = await c.ev(CHAT, `({ ritade: document.querySelectorAll('.c-item').length, text: document.getElementById('c-count').textContent })`);
        await time('öppna den långa chatten', async () => {
            await c.ev(CHAT, `[...document.querySelectorAll('.c-item')].find(b => b.innerText.includes('Den långa chatten')).click(), 1`);
            await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.view() && ChatsApp.view().n > 10000`, 600000, 'den långa chatten');
        });
        out.chatten = await c.ev(CHAT, `ChatsApp.view()`);
        // Rulla uppåt från slutet i steg om en skärm, och se hur länge varje bild (frame) tar.
        out.rulla = await c.ev(CHAT, `(async function () {
            const box = document.getElementById('c-msgs'), frames = [], drawn = [];
            const tick = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));
            let last = await tick();
            for (let k = 0; k < 120; k++) {
                box.scrollTop = Math.max(0, box.scrollTop - box.clientHeight);
                const now = await tick(); frames.push(now - last); last = now;
                drawn.push(box.querySelectorAll('.m').length);
            }
            frames.sort((a, b) => a - b);
            return { steg: frames.length, median: +frames[frames.length >> 1].toFixed(1), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(1), max: +frames[frames.length - 1].toFixed(1),
                mestRitade: Math.max(...drawn), vy: ChatsApp.view() };
        })()`);
        out.rulla.mb = rss(child.pid);
        await time('Första (överst i chatten)', async () => {
            await c.ev(CHAT, `document.getElementById('c-first').click(), 1`);
            await c.waitFor(CHAT, `ChatsApp.view().from === 0`, 60000, 'Första');
        });
        await time('sök "middag" i hela chatten', async () => {
            await c.ev(CHAT, `(function(){ const f = document.getElementById('c-find'); f.value = 'middag'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
            await c.waitFor(CHAT, `/ av /.test(document.getElementById('c-find-count').textContent)`, 60000, 'sökningen');
        });
        out.sök = await c.ev(CHAT, `document.getElementById('c-find-count').textContent`);
        await time('telefonvyn', async () => {
            await c.ev(CHAT, `document.getElementById('c-look-phone').click(), 1`);
            await sleep(300);
        });
        // Telefonen: hemskärmen, bildbiblioteket och galleriet.
        await time('telefonen: bildbiblioteket läst', async () => {
            await c.ev(CHAT, `document.getElementById('c-device-open').click(), 1`);
            await c.waitFor(CHAT, `ChatsApp.device().photos && ChatsApp.device().photos.state !== 'busy'`, 120000, 'bildbiblioteket');
        });
        out.hemskärmen = await c.ev(CHAT, `({ appar: [...document.querySelectorAll('#c-device-body .d-app')].map(a => a.getAttribute('aria-label')), bilder: ChatsApp.device().photos })`);
        await time('galleriet: första skärmen', async () => {
            await c.ev(CHAT, `document.querySelector('[data-device-photos]').click(), 1`);
            await c.waitFor(CHAT, `(function(){ const g = ChatsApp.device().gallery; if (!g) return false; const box = document.getElementById('c-device-body').getBoundingClientRect();
                const vis = [...document.querySelectorAll('#c-device-body .g-tile')].filter(t => { const r = t.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; });
                return vis.length > 0 && vis.every(t => t.classList.contains('has') || t.classList.contains('none')); })()`, 60000, 'galleriets första skärm');
        });
        out.galleriet = await c.ev(CHAT, `(async function () {
            const box = document.getElementById('c-device-body'), f = []; const tick = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));
            let last = await tick();
            for (let k = 0; k < 200; k++) { box.scrollTop += box.clientHeight * 0.5; const n = await tick(); f.push(n - last); last = n; }
            f.sort((a, b) => a - b);
            return { median: +f[100].toFixed(1), p95: +f[190].toFixed(1), max: +f[199].toFixed(1), rutor: document.querySelectorAll('#c-device-body .g-tile').length };
        })()`);
        await time('galleriet: efter rullningen', async () => {
            await c.waitFor(CHAT, `(function(){ const box = document.getElementById('c-device-body').getBoundingClientRect();
                const vis = [...document.querySelectorAll('#c-device-body .g-tile')].filter(t => { const r = t.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; });
                return vis.length > 0 && vis.every(t => t.classList.contains('has') || t.classList.contains('none')); })()`, 60000, 'bilderna efter rullningen');
        });
        out.galleriStatistik = await c.ev(CHAT, `ChatsApp.device().gallery`);
        if (process.env.FT_SHOT) await c.shot(process.env.FT_SHOT);
        out.heap = await c.ev(CHAT, `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : ''`);
        c.close();
    } finally {
        child.kill();
        await sleep(500);
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(downloads, { recursive: true, force: true });
    }
    console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
