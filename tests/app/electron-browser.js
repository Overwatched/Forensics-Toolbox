// Electron som en vanlig webbläsare för html-provet (tests/app/html.js --browser electron): adressen i FT_URL öppnas
// i ett fönster utan appens brygga (ingen preload, inga protokoll), med DevTools-protokollet på porten i FT_PORT.
// Används där Edge och Chrome saknas. Den riktiga Edge provas i CI.
'use strict';

const { app, BrowserWindow, session } = require('electron');

app.commandLine.appendSwitch('remote-debugging-port', String(process.env.FT_PORT || 9240));
if (process.env.FT_JS_FLAGS) app.commandLine.appendSwitch('js-flags', process.env.FT_JS_FLAGS);

app.whenReady().then(() => {
    if (process.env.FT_DOWNLOADS) {
        session.defaultSession.on('will-download', (_event, item) => {
            item.setSavePath(require('node:path').join(process.env.FT_DOWNLOADS, item.getFilename()));
        });
    }
    const win = new BrowserWindow({
        width: 1600, height: 1000, show: false,
        webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
    });
    win.webContents.setFrameRate(30);
    win.loadURL(process.env.FT_URL);
});

app.on('window-all-closed', () => app.quit());
