#!/usr/bin/env node
// Bygger tools/exif-viewer/vendor/exiftool/ från fastlåsta npm-paket.
//
//   node scripts/vendor-exiftool.js
//
// Installerar paketen nedan i en tillfällig mapp (npm kontrollerar integritet mot
// registret), bygger workern från scripts/exiftool/worker-entry.mjs med esbuild och
// lägger in zeroperl.wasm gzippad som base64 så att inget fetch() behövs under file://.
// SHA-256 för wasm skrivs till VERSIONS.json och kontrolleras av exif-vendor.test.js.
//
// Byt version: ändra PACKAGES, kör skriptet, granska diffen och kör npm test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PACKAGES = {
    '@uswriting/exiftool': '1.0.9',
    '@6over3/zeroperl-ts': '1.0.10',
    esbuild: '0.28.2',
};

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'exif-viewer', 'vendor', 'exiftool');
const ENTRY = path.join(__dirname, 'exiftool', 'worker-entry.mjs');

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-exiftool-'));
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ private: true }));
    const specs = Object.entries(PACKAGES).map(([name, v]) => name + '@' + v);
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--save-exact', ...specs], { cwd: work, stdio: 'inherit' });

    const lock = JSON.parse(fs.readFileSync(path.join(work, 'package-lock.json'), 'utf8'));
    const integrity = {};
    for (const name of ['@uswriting/exiftool', '@6over3/zeroperl-ts']) {
        const entry = lock.packages['node_modules/' + name];
        if (!entry || entry.version !== PACKAGES[name]) throw new Error(name + ': fel version i lockfilen');
        integrity[name] = { version: entry.version, integrity: entry.integrity };
    }

    fs.copyFileSync(ENTRY, path.join(work, 'entry.mjs'));
    const bundle = path.join(work, 'worker.js');
    execFileSync(path.join(work, 'node_modules', '.bin', 'esbuild'), [
        'entry.mjs', '--bundle', '--format=iife', '--platform=browser', '--target=chrome110',
        '--minify', '--legal-comments=none', '--external:node:*', '--outfile=' + bundle,
    ], { cwd: work, stdio: 'inherit' });

    const workerSrc = fs.readFileSync(bundle, 'utf8');
    if (/https?:\/\/[^\s"'`]*\.wasm/.test(workerSrc)) throw new Error('workern refererar en extern wasm-URL');

    const wasmPath = path.join(work, 'node_modules', '@6over3', 'zeroperl-ts', 'dist', 'esm', 'zeroperl.wasm');
    const wasm = fs.readFileSync(wasmPath);
    const gz = zlib.gzipSync(wasm, { level: 9 });

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'exiftool-worker.js'),
        '// ExifTool-worker, byggd av scripts/vendor-exiftool.js — redigera inte för hand.\n'
        + '// @uswriting/exiftool ' + PACKAGES['@uswriting/exiftool'] + ' och @6over3/zeroperl-ts '
        + PACKAGES['@6over3/zeroperl-ts'] + ' (Apache-2.0). Se LICENSES.txt.\n'
        + 'window.EXIFTOOL_WORKER_SOURCE = ' + JSON.stringify(workerSrc) + ';\n');
    fs.writeFileSync(path.join(OUT, 'zeroperl-wasm.js'),
        '// zeroperl.wasm (Perl 5 + ExifTool) från @6over3/zeroperl-ts ' + PACKAGES['@6over3/zeroperl-ts']
        + ', gzip + base64 så att inget fetch() behövs under file://.\n'
        + '// Byggd av scripts/vendor-exiftool.js — redigera inte för hand.\n'
        + 'window.EXIFTOOL_WASM_GZ = "' + gz.toString('base64') + '";\n');
    fs.writeFileSync(path.join(OUT, 'VERSIONS.json'), JSON.stringify({
        packages: integrity,
        wasmSha256: sha256(wasm),
        wasmBytes: wasm.length,
    }, null, 2) + '\n');

    for (const name of ['@uswriting/exiftool']) {
        const lic = path.join(work, 'node_modules', name, 'LICENSE');
        if (!fs.existsSync(lic)) throw new Error(name + ' saknar LICENSE');
    }
    fs.copyFileSync(path.join(work, 'node_modules', '@uswriting', 'exiftool', 'LICENSE'), path.join(OUT, 'LICENSE-Apache-2.0.txt'));

    console.log('wasm sha256 ' + sha256(wasm) + ' (' + wasm.length + ' byte, gzip ' + gz.length + ')');
    console.log('worker ' + workerSrc.length + ' byte');
    fs.rmSync(work, { recursive: true, force: true });
}

main();
