#!/usr/bin/env node
// Hämtar offlinekartorna som maps/kartdata.json pekar på (release-filer på GitHub) och
// kontrollerar SHA-256. Filer som redan finns med rätt hash hoppas över.
//
//   node scripts/fetch-map-data.js

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'maps');
const REPO = 'Overwatched/Forensics-Toolbox';

function sha256File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
    });
}

async function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'kartdata.json'), 'utf8'));
    for (const [name, info] of Object.entries(manifest.files)) {
        const file = path.join(DIR, name);
        if (fs.existsSync(file) && fs.statSync(file).size === info.bytes && await sha256File(file) === info.sha256) {
            console.log(name + ': finns redan');
            continue;
        }
        const url = 'https://github.com/' + REPO + '/releases/download/' + manifest.release + '/' + name;
        console.log(name + ': hämtar ' + Math.round(info.bytes / 1e6) + ' MB från ' + url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(name + ': HTTP ' + res.status);
        const tmp = file + '.part';
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
        const hash = await sha256File(tmp);
        if (hash !== info.sha256) {
            fs.rmSync(tmp, { force: true });
            throw new Error(name + ': fel SHA-256 (' + hash + ')');
        }
        fs.renameSync(tmp, file);
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
