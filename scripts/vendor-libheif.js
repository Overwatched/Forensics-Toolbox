#!/usr/bin/env node
// Bygger tools/_shared/vendor/libheif/ från ett fastlåst npm-paket.
//
//   node scripts/vendor-libheif.js
//
// Installerar libheif-js i en tillfällig mapp (npm kontrollerar integritet mot registret) och lägger dess
// wasm-bundle (libheif och HEVC-avkodaren libde265, WebAssembly inbakat) tillsammans med
// scripts/libheif/worker-entry.js som källkoden till en worker, i en global så att inget fetch() behövs under
// file://. Licenserna kopieras, och SHA-256 för bundlen skrivs till VERSIONS.json, som heic.test.js kontrollerar.
//
// Byt version: ändra VERSION, kör skriptet, granska diffen och kör npm test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '1.23.5';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', '_shared', 'vendor', 'libheif');
const ENTRY = path.join(__dirname, 'libheif', 'worker-entry.js');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function main() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-libheif-'));
    try {
        fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ private: true }));
        execFileSync('npm', ['install', '--no-audit', '--no-fund', '--save-exact', 'libheif-js@' + VERSION], { cwd: work, stdio: 'inherit' });
        const lock = JSON.parse(fs.readFileSync(path.join(work, 'package-lock.json'), 'utf8'));
        const entry = lock.packages['node_modules/libheif-js'];
        if (!entry || entry.version !== VERSION) throw new Error('libheif-js: fel version i lockfilen');
        const pkg = path.join(work, 'node_modules', 'libheif-js');
        const bundle = fs.readFileSync(path.join(pkg, 'libheif-wasm', 'libheif-bundle.js'));
        const text = bundle.toString('utf8');
        if (/https?:\/\/[^\s"'`]*\.wasm/.test(text)) throw new Error('bundlen refererar en extern wasm-URL');
        if (!/libheif=libheif\.default/.test(text.replace(/\s/g, ''))) throw new Error('bundlen ger inte globalen libheif som väntat');
        const worker = text + '\n;\n' + fs.readFileSync(ENTRY, 'utf8');

        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, 'libheif-worker.js'),
            '// HEIC-avkodarens worker, byggd av scripts/vendor-libheif.js — redigera inte för hand.\n'
            + '// libheif-js ' + VERSION + ' (libheif och libde265, LGPL-3.0). Se README.txt och licenserna i mappen.\n'
            + 'window.LIBHEIF_WORKER_SOURCE = ' + JSON.stringify(worker) + ';\n');
        fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(OUT, 'LICENSE-libheif-js.txt'));
        fs.copyFileSync(path.join(pkg, 'libheif-wasm', 'LICENSE'), path.join(OUT, 'LICENSE-libheif.txt'));
        fs.writeFileSync(path.join(OUT, 'VERSIONS.json'), JSON.stringify({
            package: { name: 'libheif-js', version: VERSION, integrity: entry.integrity, resolved: entry.resolved },
            bundleSha256: sha256(bundle),
            bundleBytes: bundle.length,
        }, null, 2) + '\n');
        console.log('vendor-libheif: ' + path.relative(ROOT, OUT) + ' (' + bundle.length + ' byte bundle)');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

main();
