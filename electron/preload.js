// Skrivbordsappen. HTML-mappen i webbläsaren har inte den här flaggan, och ska
// därför inte anropa ftmaps:// eller ftmedia:// (de schemana finns bara här).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Preload körs i alla ramar (nodeIntegrationInSubFrames). Bryggan ges bara till
// appens egna sidor (file://), aldrig till en webbsida som hamnat i en iframe.
if (location.protocol === 'file:') {
    contextBridge.exposeInMainWorld('forensicsDesktop', true);
    contextBridge.exposeInMainWorld('forensicsMedia', {
        pathFor: function (file) {
            try { return webUtils.getPathForFile(file) || ''; }
            catch (err) { return ''; }
        },
        allow: function (filePath) { return ipcRenderer.invoke('media-allow', filePath); },
        revoke: function (filePath) { return ipcRenderer.invoke('media-revoke', filePath); },
    });
}
