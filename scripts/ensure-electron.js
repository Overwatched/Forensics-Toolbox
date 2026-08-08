#!/usr/bin/env node
// Fallback när electron/postinstall (extract-zip) misslyckas tyst —
// vanligt med nyare Node (t.ex. v26) på Linux. Packar upp cachat zip
// (eller laddar ner det) till node_modules/electron/dist.

const { downloadArtifact } = require('@electron/get');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const binary = path.join(distDir, process.platform === 'win32' ? 'electron.exe' : 'electron');
const { version } = require(path.join(electronDir, 'package.json'));

if (fs.existsSync(binary)) {
  console.log(`ensure-electron: OK (${binary})`);
  process.exit(0);
}

(async () => {
  console.log(`ensure-electron: saknar binär, hämtar Electron ${version}...`);
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
  });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  // System-unzip är mer pålitligt än extract-zip på vissa Node-versioner.
  execFileSync('unzip', ['-o', zipPath, '-d', distDir], { stdio: 'inherit' });
  fs.writeFileSync(path.join(electronDir, 'path.txt'), process.platform === 'win32' ? 'electron.exe' : 'electron');

  if (!fs.existsSync(binary)) {
    console.error('ensure-electron: uppackning klar men binären saknas fortfarande');
    process.exit(1);
  }
  console.log(`ensure-electron: installerad -> ${binary}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
