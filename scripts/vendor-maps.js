#!/usr/bin/env node
// Bygger tools/exif-viewer/vendor/maps/ från fastlåsta paket och en fastlåst commit.
//
//   node scripts/vendor-maps.js
//
// - maplibre.js: MapLibre GL och pmtiles som vanligt skript (esbuild), plus MapLibres
//   worker som sträng så att den kan startas från en Blob-URL under file://.
// - map-assets.js: Protomaps-stilens lager (ljust och mörkt, svenska namn), typsnitt
//   och ikoner från protomaps/basemaps-assets, base64 i ett skript. Kartan hämtar då
//   inget utanför datorn i offlineläge.
//
// Byt version: ändra PACKAGES eller ASSETS_COMMIT, kör skriptet och kör npm test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PACKAGES = {
    'maplibre-gl': '6.14.0',
    pmtiles: '4.5.0',
    '@protomaps/basemaps': '5.7.2',
    esbuild: '0.28.2',
};
const ASSETS_REPO = 'protomaps/basemaps-assets';
const ASSETS_COMMIT = '028c18f713baecad011301ff7a69acc39bcc2ae7';
const SPRITES = ['light', 'dark'];

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'exif-viewer', 'vendor', 'maps');

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function esbuild(work, entry, outfile) {
    execFileSync(path.join(work, 'node_modules', '.bin', 'esbuild'), [
        entry, '--bundle', '--format=iife', '--platform=browser', '--target=chrome110',
        '--minify', '--legal-comments=none', '--log-level=error', '--outfile=' + outfile,
    ], { cwd: work, stdio: 'inherit' });
    return fs.readFileSync(outfile, 'utf8');
}

// Typsnitt står både i text-font och inuti format-uttryck (t.ex. devanagari).
function fontsUsed(layers) {
    const fonts = new Set();
    JSON.stringify(layers).replace(/"(Noto [^"]+)"/g, (_, f) => fonts.add(f));
    return [...fonts].sort();
}

async function main() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-maps-'));
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
    const specs = Object.entries(PACKAGES).map(([name, v]) => name + '@' + v);
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--save-exact', ...specs], { cwd: work, stdio: 'inherit' });

    const lock = JSON.parse(fs.readFileSync(path.join(work, 'package-lock.json'), 'utf8'));
    const packages = {};
    for (const name of ['maplibre-gl', 'pmtiles', '@protomaps/basemaps']) {
        const entry = lock.packages['node_modules/' + name];
        if (!entry || entry.version !== PACKAGES[name]) throw new Error(name + ': fel version i lockfilen');
        packages[name] = { version: entry.version, integrity: entry.integrity };
    }

    fs.copyFileSync(path.join(__dirname, 'maps', 'map-entry.mjs'), path.join(work, 'entry.mjs'));
    // Paketet är märkt sideEffects: false, så en ren import skulle tas bort helt.
    fs.writeFileSync(path.join(work, 'worker.mjs'),
        "import Worker from 'maplibre-gl/dist/maplibre-gl-worker.mjs';\nself.MapLibreWorker = Worker;\n");
    const lib = esbuild(work, 'entry.mjs', path.join(work, 'lib.js'));
    const worker = esbuild(work, 'worker.mjs', path.join(work, 'worker.js'));

    fs.copyFileSync(path.join(__dirname, 'maps', 'layers.mjs'), path.join(work, 'layers.mjs'));
    const layers = JSON.parse(execFileSync(process.execPath, ['layers.mjs'], { cwd: work, maxBuffer: 64 << 20 }).toString());

    const tarball = path.join(work, 'assets.tar.gz');
    const res = await fetch('https://codeload.github.com/' + ASSETS_REPO + '/tar.gz/' + ASSETS_COMMIT);
    if (!res.ok) throw new Error('basemaps-assets: HTTP ' + res.status);
    fs.writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['xzf', 'assets.tar.gz'], { cwd: work });
    const assetsDir = path.join(work, 'basemaps-assets-' + ASSETS_COMMIT);

    const glyphs = {};
    let glyphBytes = 0;
    for (const font of fontsUsed(layers.light.concat(layers.dark))) {
        const dir = path.join(assetsDir, 'fonts', font);
        if (!fs.existsSync(dir)) throw new Error('typsnitt saknas: ' + font);
        glyphs[font] = {};
        for (const file of fs.readdirSync(dir).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
            const buf = fs.readFileSync(path.join(dir, file));
            // Tomma intervall (t.ex. CJK) ritar MapLibre med datorns egna typsnitt.
            if (buf.length < 64) continue;
            glyphs[font][file.replace(/\.pbf$/, '')] = buf.toString('base64');
            glyphBytes += buf.length;
        }
    }

    const sprites = {};
    for (const name of SPRITES) {
        for (const suffix of ['', '@2x']) {
            const base = path.join(assetsDir, 'sprites', 'v4', name + suffix);
            sprites[name + suffix] = {
                json: JSON.parse(fs.readFileSync(base + '.json', 'utf8')),
                png: fs.readFileSync(base + '.png').toString('base64'),
            };
        }
    }

    fs.mkdirSync(OUT, { recursive: true });
    const header = '// Byggd av scripts/vendor-maps.js — redigera inte för hand. Se LICENSES.txt.\n';
    fs.writeFileSync(path.join(OUT, 'maplibre.js'), header
        + '// maplibre-gl ' + PACKAGES['maplibre-gl'] + ', pmtiles ' + PACKAGES.pmtiles + ' (BSD-3-Clause).\n'
        + lib + '\nwindow.MAPLIBRE_WORKER_SOURCE = ' + JSON.stringify(worker) + ';\n');
    fs.copyFileSync(path.join(work, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css'), path.join(OUT, 'maplibre-gl.css'));
    fs.writeFileSync(path.join(OUT, 'map-assets.js'), header
        + '// Lager från @protomaps/basemaps ' + PACKAGES['@protomaps/basemaps'] + ', typsnitt och ikoner från '
        + ASSETS_REPO + '@' + ASSETS_COMMIT.slice(0, 12) + '.\n'
        + 'window.MAP_ASSETS = ' + JSON.stringify({ layers, glyphs, sprites }) + ';\n');

    const licenses = [
        ['maplibre-gl', 'LICENSE.txt'],
        ['pmtiles', 'LICENSE'],
        ['@protomaps/basemaps', 'LICENSE'],
    ].map(([name, file]) => {
        const p = path.join(work, 'node_modules', name, file);
        return '== ' + name + ' ' + PACKAGES[name] + ' ==\n\n' + (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'BSD-3-Clause\n');
    });
    licenses.push('== Typsnitt (Noto Sans) från ' + ASSETS_REPO + ' ==\n\n'
        + fs.readFileSync(path.join(assetsDir, 'fonts', 'OFL.txt'), 'utf8'));
    licenses.push('== Ikoner från ' + ASSETS_REPO + ' ==\n\nHärledda från tangrams/icons (MIT): '
        + 'https://github.com/tangrams/icons/blob/master/LICENSE.md\n');
    licenses.push('== Kartdata ==\n\n© OpenStreetMap-bidragsgivare, Open Database License (ODbL) 1.0: '
        + 'https://www.openstreetmap.org/copyright. Tiles från Protomaps (https://protomaps.com), '
        + 'låga zoomnivåer från Natural Earth (public domain).\n');
    fs.writeFileSync(path.join(OUT, 'LICENSES.txt'), licenses.join('\n\n'));

    fs.writeFileSync(path.join(OUT, 'VERSIONS.json'), JSON.stringify({
        packages,
        assets: { repo: ASSETS_REPO, commit: ASSETS_COMMIT, fonts: Object.keys(glyphs), sprites: SPRITES },
        sha256: {
            'maplibre.js': sha256(fs.readFileSync(path.join(OUT, 'maplibre.js'))),
            'map-assets.js': sha256(fs.readFileSync(path.join(OUT, 'map-assets.js'))),
        },
    }, null, 2) + '\n');

    console.log('maplibre.js ' + lib.length + ' + worker ' + worker.length + ' byte');
    console.log('typsnitt ' + Object.keys(glyphs).join(', ') + ' (' + glyphBytes + ' byte), ikoner ' + SPRITES.join(', '));
    fs.rmSync(work, { recursive: true, force: true });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
