#!/usr/bin/env node
// Kör alla enhetstester under tools/.
//
// `node --test "tools/**/*.test.js"` fungerar inte överallt: Node 20 tolkar mönstret
// som en literal sökväg och Node 26 tolkar en katalog som en fil att köra. Därför
// letar vi upp filerna själva och skickar dem som explicita argument, vilket har
// fungerat likadant sedan Node 18.
//
// Körs som `npm test`, både lokalt och i CI.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'tools');
const SKIP_DIRS = new Set(['node_modules', 'CyberChef']);

function findTests(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            found.push(...findTests(path.join(dir, entry.name)));
        } else if (entry.name.endsWith('.test.js')) {
            found.push(path.join(dir, entry.name));
        }
    }
    return found;
}

const tests = findTests(TOOLS_DIR).sort();

if (!tests.length) {
    console.error('run-tests: hittade inga *.test.js under tools/');
    process.exit(1);
}

const relative = tests.map((file) => path.relative(ROOT, file));
console.log(`run-tests: kör ${relative.length} testfiler\n${relative.map((f) => '  ' + f).join('\n')}\n`);

const result = spawnSync(process.execPath, ['--test', ...relative], {
    cwd: ROOT,
    stdio: 'inherit',
});

if (result.error) {
    console.error('run-tests:', result.error.message);
    process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
