#!/usr/bin/env node
// Bygger tools/db-queries/fixtures/photos-schema.json ur iLEAPP:s Photos-tolkare.
//
// Schemat innehåller de tabeller och kolumner som iLEAPP läser i Photos.sqlite för
// varje iOS-version. Testet photos-catalog.test.js kör våra mallar mot det, så en
// mall som använder en kolumn som inte finns i en version fångas innan release.
//
// Körs med en lokal klon av iLEAPP:
//   git clone --depth 1 https://github.com/abrignoni/iLEAPP /tmp/iLEAPP
//   node scripts/photos-schema-from-ileapp.js /tmp/iLEAPP/scripts/artifacts
//
// iOS 11–13 tas från de versionssektioner i Ph0*.py som läser ZGENERICASSET.
// iOS 14 och senare tas från referensfrågorna (REFforAssetAnalysis), som läser alla
// kolumner iLEAPP känner till för versionen. Lägg till nya versioner i REF nedan.

const fs = require('node:fs');
const path = require('node:path');

const REF = {
    14: 'Ph094Ios14REFforAssetAnalysis.py',
    15: 'Ph095iOS15REFforAssetAnalysis.py',
    16: 'Ph096iOS16REFforAssetAnalysis.py',
    17: 'Ph097iOS17REFforAssetAnalysis.py',
    18: 'Ph098iOS18REFforAssetAnalysis.py',
    26: 'Ph126iOS26REFforAssetAnalysis.py',
};

const ALIAS_RE = /(?:FROM|JOIN)\s+(Z_?\w+)\s+(\w+)/gi;
const COL_RE = /\b(\w+)\.(Z_?[A-Z0-9_]+)\b/g;
const SECTION_RE = /\n\s*(?:el)?if \(version\.parse\(iosversion\)/;
const NOT_ALIAS = new Set(['ON', 'WHERE', 'LEFT', 'INNER', 'AS']);

function collect(text, schema) {
    const aliases = {};
    for (const [, table, alias] of text.matchAll(ALIAS_RE)) {
        if (NOT_ALIAS.has(alias.toUpperCase())) continue;
        aliases[alias] = table.toUpperCase();
        if (!schema[table.toUpperCase()]) schema[table.toUpperCase()] = new Set();
        schema[table.toUpperCase()].add('Z_PK');
    }
    for (const [, alias, col] of text.matchAll(COL_RE)) {
        const table = aliases[alias];
        if (table) schema[table].add(col.toUpperCase());
    }
}

function sectionVersions(head) {
    return [...head.matchAll(/"([\d.]+)"/g)].map((m) => Number(m[1].split('.').slice(0, 2).join('.')));
}

function main() {
    const dir = process.argv[2];
    if (!dir || !fs.existsSync(dir)) {
        console.error('Ange sökvägen till iLEAPP/scripts/artifacts');
        process.exit(1);
    }

    const schemas = {};
    const legacy = {};
    for (const name of fs.readdirSync(dir).filter((f) => /^Ph0.*\.py$/.test(f)).sort()) {
        const parts = fs.readFileSync(path.join(dir, name), 'utf8').split(SECTION_RE).slice(1);
        for (const part of parts) {
            const nums = sectionVersions(part.split(':', 1)[0]);
            if (nums.length === 2 && nums[0] >= 11 && nums[1] <= 14 && part.includes('ZGENERICASSET')) {
                collect(part, legacy);
            }
        }
    }
    schemas['11-13'] = legacy;

    for (const [version, name] of Object.entries(REF)) {
        const schema = {};
        collect(fs.readFileSync(path.join(dir, name), 'utf8'), schema);
        schemas[version] = schema;
    }

    const out = {
        _source: 'Tabeller och kolumner som iLEAPP (MIT, Photos-tolkare av Scott Koenig) läser i Photos.sqlite. '
            + 'Genererad av scripts/photos-schema-from-ileapp.js — redigera inte för hand.',
    };
    for (const version of Object.keys(schemas).sort()) {
        const tables = {};
        for (const table of Object.keys(schemas[version]).sort()) {
            tables[table] = [...schemas[version][table]].sort();
        }
        out[version] = tables;
    }

    const target = path.join(__dirname, '..', 'tools', 'db-queries', 'fixtures', 'photos-schema.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
    console.log('Skrev ' + path.relative(process.cwd(), target) + ': ' + Object.keys(schemas).join(', '));
}

main();
