#!/usr/bin/env node
// Fallback när electron/postinstall (extract-zip) misslyckas tyst —
// vanligt med nyare Node (t.ex. v26) på Linux. Packar upp cachat zip
// (eller laddar ner det) till node_modules/electron/dist.

const { downloadArtifact } = require('@electron/get');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const { version } = require(path.join(electronDir, 'package.json'));

function platformPath() {
  switch (process.platform) {
    case 'win32':
      return 'electron.exe';
    case 'darwin':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    default:
      return 'electron';
  }
}

function resolveBinary() {
  return path.join(distDir, platformPath());
}

function writePathTxt() {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath());
}

const binary = resolveBinary();

if (fs.existsSync(binary)) {
  try {
    writePathTxt();
  } catch (e) {
    /* ignore */
  }
  console.log(`ensure-electron: OK (${binary})`);
  process.exit(0);
}

(async () => {
  console.log(`ensure-electron: saknar binär (${process.platform}), hämtar Electron ${version}...`);
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
  writePathTxt();

  const installed = resolveBinary();
  if (!fs.existsSync(installed)) {
    console.error(`ensure-electron: uppackning klar men binären saknas fortfarande: ${installed}`);
    process.exit(1);
  }
  console.log(`ensure-electron: installerad -> ${installed}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
