#!/usr/bin/env node
// Packar en mapp (och zip) med de statiska filer som behövs för att öppna
// Toolbox.html utan Electron/.exe — t.ex. i låsta miljöer.
//
// Output:
//   release/ForensicsToolbox-X.Y-html/
//   release/ForensicsToolbox-X.Y-html.zip

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const TOOLBOX_HTML = path.join(ROOT, 'Toolbox.html');

const html = fs.readFileSync(TOOLBOX_HTML, 'utf8');
const match = html.match(/Version\s+(\d+)\.(\d+)\b/);
if (!match) {
    console.error('pack-html-folder: kunde inte hitta "Version X.Y" i Toolbox.html');
    process.exit(1);
}
const shortVersion = `${match[1]}.${match[2]}`;
const folderName = `ForensicsToolbox-${shortVersion}-html`;
const dest = path.join(RELEASE_DIR, folderName);
const zipPath = path.join(RELEASE_DIR, `${folderName}.zip`);

const INCLUDE = [
    'Toolbox.html',
    'src',
    'tools',
    'documentation',
    'queries',
];

function copyRecursive(src, dst) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        for (const name of fs.readdirSync(src)) {
            if (name === '.DS_Store' || name === 'Thumbs.db') continue;
            if (name === 'fixtures' || name.endsWith('.test.js')) continue;
            copyRecursive(path.join(src, name), path.join(dst, name));
        }
        return;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

fs.mkdirSync(RELEASE_DIR, { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const item of INCLUDE) {
    const from = path.join(ROOT, item);
    if (!fs.existsSync(from)) {
        console.error(`pack-html-folder: saknar ${item}`);
        process.exit(1);
    }
    copyRecursive(from, path.join(dest, item));
}

const mapNames = ['kartdata.json', 'world.pmtiles', 'sweden.pmtiles'];
const mapDir = path.join(ROOT, 'maps');
const missingMaps = mapNames.filter((name) => !fs.existsSync(path.join(mapDir, name)));
if (missingMaps.length) {
    console.error('pack-html-folder: saknar ' + missingMaps.join(', ') + ' i maps/. Kör npm run fetch-maps först.');
    process.exit(1);
}
fs.mkdirSync(path.join(dest, 'maps'), { recursive: true });
mapNames.forEach((name) => fs.copyFileSync(path.join(mapDir, name), path.join(dest, 'maps', name)));
console.log('pack-html-folder: tar med offlinekartan (' + mapNames.join(', ') + ')');

const readme = [
    'Forensics Toolbox ' + shortVersion + ' — HTML-mapp',
    '',
    'Den här mappen innehåller de filer som behövs för att köra verktygslådan',
    'utan .exe / Electron. Använd den när körbara filer inte är tillåtna.',
    '',
    'Start:',
    '  1. Packa upp zip-filen om den inte redan är uppackad.',
    '  2. Öppna Toolbox.html i Edge eller Chrome.',
    '  3. Gå till EXIF & karta eller Positioner.',
    '  4. Välj mappen maps. Dialogen är en mapp, inte en enstaka fil.',
    '',
    'Kartan läser filerna direkt från mappen. Ingen server och inget skript behövs.',
    'Valet görs igen varje gång sidan öppnas.',
    '',
    'Query-katalogerna har JS-fallback',
    'så de fungerar även när fetch() av .json blockeras.',
    '',
    'Kartan:',
    '  Offlinekartan (världen i översikt, Sverige på gatunivå) ligger i mappen maps.',
    '',
].join('\n');

fs.writeFileSync(path.join(dest, 'LÄS MIG.txt'), readme, 'utf8');

function countFiles(dir) {
    let n = 0;
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        n += fs.statSync(p).isDirectory() ? countFiles(p) : 1;
    }
    return n;
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execFileSync('zip', ['-r', '-q', zipPath, folderName], { cwd: RELEASE_DIR });

const fileCount = countFiles(dest);
const zipStat = fs.statSync(zipPath);
fs.rmSync(dest, { recursive: true, force: true });

console.log(`pack-html-folder: ${folderName} (${fileCount} filer)`);
console.log(`pack-html-folder: ${path.basename(zipPath)} (${Math.round(zipStat.size / 1024 / 1024)} MB)`);
