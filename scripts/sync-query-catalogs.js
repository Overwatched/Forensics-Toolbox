#!/usr/bin/env node
// Skriver om queries/**/catalog.js från catalog.json.
//
// Verktyget Queries läser catalog.js eftersom fetch() av JSON blockeras under file://.
// catalog.json är källan; kör `npm run sync-queries` efter varje ändring i den.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const CATALOGS = [
    { dir: 'queries/ios/photos-sqlite', global: 'PHOTOS_SQLITE_CATALOG', name: 'photos-sqlite/catalog.json' },
    { dir: 'queries/app-usage', global: 'APP_USAGE_CATALOG', name: 'app-usage/catalog.json' },
    { dir: 'queries/android', global: 'ANDROID_QUERIES_CATALOG', name: 'android/catalog.json' },
    { dir: 'queries/ios/routined', global: 'ROUTINED_CATALOG', name: 'routined/catalog.json' },
];

function render(catalog) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, catalog.dir, 'catalog.json'), 'utf8'));
    return '/* Genererad från ' + catalog.name + ' — används när fetch() blockeras (file://). */\n'
        + 'window.' + catalog.global + ' = ' + JSON.stringify(json, null, 2) + ';\n';
}

function main() {
    for (const catalog of CATALOGS) {
        const target = path.join(ROOT, catalog.dir, 'catalog.js');
        const next = render(catalog);
        const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
        if (prev === next) continue;
        fs.writeFileSync(target, next);
        console.log('Uppdaterade ' + path.relative(ROOT, target));
    }
}

if (require.main === module) main();

module.exports = { CATALOGS, render };
