// Nyckelfiler bredvid en extraktion, i skrivbordsappen: en webbläsare får inte se mappen där en vald fil
// ligger. Bara vanliga filer vars namn ser ut som nyckelfiler öppnas, bara för läsning. Vilka som hör till
// extraktionen avgörs av AppSecrets.besideKeyFiles, som aldrig väljer på chans. Huvudfönstret frågar, åt
// verktygen: deras extraktionskod når inte huvudprocessen.

const fs = require('node:fs');
const path = require('node:path');
const AppSecrets = require('../tools/db-queries/app-secrets.js');
const { readRange } = require('./media-protocol');

// En nyckelring är några MB. Större än så är inte en nyckelfil, oavsett vad den heter.
const MAX_KEY_FILE = 64 * 1024 * 1024;

// filePath: den valda zippen eller rapporten. -> { files: [{ name, bytes }], other: [namn] }, eller null när
// mappen inte går att läsa.
async function beside(filePath) {
    if (!filePath || typeof filePath !== 'string' || !/\.(zip|ufdr)$/i.test(filePath)) return null;
    const dir = path.dirname(filePath);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (err) { return null; }
    const names = entries.filter((e) => e.isFile()).map((e) => e.name);
    const chosen = AppSecrets.besideKeyFiles(path.basename(filePath), names);
    const out = { files: [], other: chosen.other };
    for (const name of chosen.use) {
        try {
            const at = path.join(dir, name);
            const st = await fs.promises.stat(at);
            if (st.size > MAX_KEY_FILE) { out.other.push(name); continue; }
            out.files.push({ name: name, bytes: new Uint8Array(await readRange(at, 0, st.size)) });
        } catch (err) {
            out.other.push(name);
        }
    }
    return out;
}

module.exports = { beside, MAX_KEY_FILE };
