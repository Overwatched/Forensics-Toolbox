'use strict';
// Var labbmaterialet ligger. Samma mappar ("1 Labbar/<datum> <labb>/...", se LÄSMIG.txt i mappen) under den första
// roten där filen finns: FT_LAB_ROOT, ~/Documents/Exampleextractions eller ~/Desktop/vm-images.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [process.env.FT_LAB_ROOT, path.join(os.homedir(), 'Documents', 'Exampleextractions'), path.join(os.homedir(), 'Desktop', 'vm-images')].filter(Boolean);

function labPath(rel) {
    for (const root of ROOTS) {
        const p = path.join(root, rel);
        if (fs.existsSync(p)) return p;
    }
    return path.join(ROOTS[0], rel);
}

module.exports = { ROOTS, labPath };
