// Electron för provkörningarna: samma sida, protokoll och IPC som electron/main.js, men i ett
// fönster som ritas utan skärm (offscreen), så att kartan och tidslinjerna ritas också när skärmen är
// låst eller saknas (i CI). DevTools-protokollet på porten i FT_PORT. Nedladdningar sparas i
// FT_DOWNLOADS utan dialog. Startas av tests/app/run.js, inte av appen.
'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const maps = require(path.join(ROOT, 'electron', 'map-protocol'));
const media = require(path.join(ROOT, 'electron', 'media-protocol'));
const keyFiles = require(path.join(ROOT, 'electron', 'key-files'));

app.commandLine.appendSwitch('remote-debugging-port', String(process.env.FT_PORT || 9223));
maps.registerMapScheme();

app.whenReady().then(() => {
    if (process.env.FT_DOWNLOADS) {
        session.defaultSession.on('will-download', (_event, item) => {
            item.setSavePath(path.join(process.env.FT_DOWNLOADS, item.getFilename()));
        });
    }
    maps.handleMapProtocol(path.join(ROOT, 'maps'));
    media.handleMediaProtocol();
    ipcMain.handle('media-allow', (_event, filePath) => media.allow(filePath));
    ipcMain.handle('media-revoke', (_event, filePath) => media.revoke(filePath));
    ipcMain.handle('media-times', (_event, filePath) => media.times(filePath));
    ipcMain.handle('keys-beside', (_event, filePath) => keyFiles.beside(filePath));
    const win = new BrowserWindow({
        width: 1600, height: 1000, show: false,
        webPreferences: {
            offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true,
            preload: path.join(ROOT, 'electron', 'preload.js'), nodeIntegrationInSubFrames: true, webSecurity: true, spellcheck: false,
        },
    });
    win.webContents.setFrameRate(30);
    win.loadFile(path.join(ROOT, 'Toolbox.html'));
});

app.on('window-all-closed', () => app.quit());
