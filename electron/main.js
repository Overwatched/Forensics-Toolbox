const { app, BrowserWindow, shell, Menu, session, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const maps = require('./map-protocol');
const media = require('./media-protocol');

// Sökväg till projektroten. I dev-läge (npm start) är detta repo-roten.
// I ett paketerat bygge (electron-builder, asar: false) är strukturen identisk under
// resources/app, så samma relativa sökvägar fungerar i båda fallen.
const APP_ROOT = path.join(__dirname, '..');
const TOOLBOX_HTML = path.join(APP_ROOT, 'Toolbox.html');
const ICON_PATH = path.join(APP_ROOT, 'build', 'icon.ico');
const MAPS_DIR = path.join(APP_ROOT, 'maps');

maps.registerMapScheme();
app.userAgentFallback = maps.genericUserAgent(app.userAgentFallback, [app.getName(), 'forensics-toolbox']);

let mainWindow = null;

function isHttpUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

function isFileUrl(url) {
    try {
        return new URL(url).protocol === 'file:';
    } catch (err) {
        return false;
    }
}

// Bara appens egna sidor (file://) får öppna filer för visning.
function fromAppPage(event) {
    const frame = event.senderFrame;
    return !!frame && isFileUrl(frame.url);
}

function createWindow() {
    const windowOptions = {
        width: 1440,
        height: 920,
        minWidth: 960,
        minHeight: 640,
        backgroundColor: '#1e1e23',
        autoHideMenuBar: true, // menyraden döljs men nås via Alt-tangenten
        show: false,
        webPreferences: {
            // Verktygen körs som lokalt, statiskt innehåll och behöver aldrig Node-åtkomst.
            // Det här är säkra standardinställningar som isolerar sidans JS (inkl. tredjeparts-
            // bibliotek som CyberChef) från operativsystemet.
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js'),
            // Verktygen ligger i iframes i Toolbox.html. Utan detta körs preload bara i
            // huvudramen och kartan hittar inte forensicsDesktop. Med sandbox och
            // contextIsolation får ramarna ändå ingen Node-åtkomst.
            nodeIntegrationInSubFrames: true,
            webSecurity: true,
            spellcheck: false,
            // Krävs för Chromiums inbyggda PDF-visare.
            plugins: true,
        },
    };

    if (fs.existsSync(ICON_PATH)) {
        windowOptions.icon = ICON_PATH;
    }

    mainWindow = new BrowserWindow(windowOptions);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.loadFile(TOOLBOX_HTML);

    // Sidopanelens externa länkar/nedladdningar öppnas idag via window.open() efter en
    // bekräftelsedialog i sidan själv. Låt dem öppnas i systemets standardwebbläsare
    // istället för i ett nytt Electron-fönster.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isHttpUrl(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Extra skyddsnät: om något top-level-försök att navigera till en extern URL skulle
    // slinka igenom (t.ex. en trasig länk), öppna den externt istället för att lämna appen.
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isHttpUrl(url)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // Samma skydd för verktygens iframes: en länk i t.ex. CyberChef får inte ladda en
    // webbsida i ramen, där den skulle hamna bredvid appens egna sidor.
    mainWindow.webContents.on('will-frame-navigate', (event) => {
        if (event.isMainFrame) return;
        if (isHttpUrl(event.url)) {
            event.preventDefault();
            shell.openExternal(event.url);
        } else if (!isFileUrl(event.url) && !/^(about|blob|data):/.test(event.url)) {
            event.preventDefault();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function buildMenu() {
    const template = [
        {
            label: 'Visa',
            submenu: [
                {
                    label: 'Ladda om',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => mainWindow && mainWindow.webContents.reload(),
                },
                {
                    label: 'Tvinga omladdning',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => mainWindow && mainWindow.webContents.reloadIgnoringCache(),
                },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Återställ zoom' },
                { role: 'zoomIn', label: 'Zooma in' },
                { role: 'zoomOut', label: 'Zooma ut' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Helskärm' },
                { type: 'separator' },
                { role: 'toggleDevTools', label: 'Utvecklarverktyg' },
            ],
        },
        {
            label: 'Hjälp',
            submenu: [
                {
                    label: 'Öppna på GitHub',
                    click: () => shell.openExternal('https://github.com/Overwatched/Forensics-Toolbox'),
                },
                {
                    label: 'Om Forensics Toolbox',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Om Forensics Toolbox',
                            message: 'Forensics Toolbox',
                            detail: `Version ${app.getVersion()}\n\nLokal verktygslåda för IT-forensik. Körs helt lokalt på den här datorn. Ingen internetanslutning krävs för verktygen — endast för de valfria externa länkarna i sidopanelen och den valfria onlinekartan i EXIF-visaren.\n\nKartdata © OpenStreetMap-bidragsgivare (ODbL), Protomaps.\n\nBaserad på CryptoToolbox av Adrian Neshad.`,
                        });
                    },
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
    // Visa en "Spara som"-dialog för nedladdningar istället för att tyst spara dem
    // i standardmappen för nedladdningar.
    session.defaultSession.on('will-download', (_event, item) => {
        item.setSaveDialogOptions({ defaultPath: item.getFilename() });
    });
    maps.handleMapProtocol(MAPS_DIR);
    media.handleMediaProtocol();
    ipcMain.handle('media-allow', function (event, filePath) {
        return fromAppPage(event) ? media.allow(filePath) : false;
    });
    ipcMain.handle('media-revoke', function (event, filePath) {
        return fromAppPage(event) ? media.revoke(filePath) : false;
    });
    maps.stripIdentifyingHeaders(session.defaultSession);

    buildMenu();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
