#!/usr/bin/env node
// Bygger offlinekartorna i maps/ ur en daglig Protomaps-build (OpenStreetMap, ODbL).
//
//   node scripts/build-map-data.js [YYYYMMDD]
//
// Kräver pmtiles-CLI (https://github.com/protomaps/go-pmtiles) i PATH eller i $PMTILES.
// Läser bara de delar av planet-filen som behövs (HTTP Range).
//
// - world.pmtiles: hela världen, zoom 0–6 (översikt)
// - sweden.pmtiles: zoom 7–14 inom scripts/maps/sweden-region.geojson (gatunivå)
//
// Skriver maps/kartdata.json med storlek och SHA-256. Filerna läggs sedan upp som
// release-filer under taggen i "release"; scripts/fetch-map-data.js hämtar dem vid bygget.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'maps');
const REGION = path.join(__dirname, 'maps', 'sweden-region.geojson');
const PMTILES = process.env.PMTILES || 'pmtiles';

const FILES = [
    { name: 'world.pmtiles', label: 'Världen', minzoom: 0, maxzoom: 6, args: [] },
    { name: 'sweden.pmtiles', label: 'Sverige', minzoom: 7, maxzoom: 14, args: ['--region=' + REGION] },
];

function sha256File(file) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
    fs.closeSync(fd);
    return hash.digest('hex');
}

async function latestBuild() {
    const res = await fetch('https://build-metadata.protomaps.dev/builds.json');
    if (!res.ok) throw new Error('builds.json: HTTP ' + res.status);
    const builds = await res.json();
    return builds[builds.length - 1].key.replace(/\.pmtiles$/, '');
}

async function main() {
    const build = process.argv[2] || await latestBuild();
    if (!/^\d{8}$/.test(build)) throw new Error('Ange build som YYYYMMDD');
    const source = 'https://build.protomaps.com/' + build + '.pmtiles';
    fs.mkdirSync(OUT, { recursive: true });

    const files = {};
    for (const f of FILES) {
        const out = path.join(OUT, f.name);
        console.log(f.label + ': zoom ' + f.minzoom + '–' + f.maxzoom);
        execFileSync(PMTILES, ['extract', source, out, '--minzoom=' + f.minzoom, '--maxzoom=' + f.maxzoom,
            '--download-threads=8'].concat(f.args), { stdio: 'inherit' });
        files[f.name] = {
            label: f.label, minzoom: f.minzoom, maxzoom: f.maxzoom,
            bytes: fs.statSync(out).size, sha256: sha256File(out),
        };
    }

    const date = build.slice(0, 4) + '-' + build.slice(4, 6) + '-' + build.slice(6);
    fs.writeFileSync(path.join(OUT, 'kartdata.json'), JSON.stringify({
        source: 'Protomaps basemap ' + build + ' (OpenStreetMap)',
        date,
        license: '© OpenStreetMap-bidragsgivare, ODbL 1.0',
        release: 'kartdata-' + build,
        files,
    }, null, 2) + '\n');
    console.log('maps/kartdata.json skriven. Lägg upp filerna med:');
    console.log('  gh release create kartdata-' + build + ' --prerelease --latest=false --title "Kartdata ' + date + '" '
        + FILES.map((f) => 'maps/' + f.name).join(' '));
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
