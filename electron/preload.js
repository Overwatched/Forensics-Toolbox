// Skrivbordsappen. HTML-mappen i webbläsaren har inte den här flaggan, och ska
// därför inte anropa ftmaps:// (det schemat finns bara här).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('forensicsDesktop', true);
