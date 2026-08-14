/**
 * Ladda lokal JSON. fetch() fungerar i Electron, men webbläsare som öppnar
 * Toolbox.html via file:// blockerar det. Då används en redan inläst global
 * från motsvarande .js-fil (t.ex. catalog.js).
 */
async function loadLocalJson(jsonUrl, globalName) {
    try {
        const res = await fetch(jsonUrl);
        if (res.ok) return await res.json();
    } catch (err) {
        /* file:// eller saknad fil — prova inbäddad global */
    }
    if (globalName && typeof window[globalName] !== 'undefined') {
        return window[globalName];
    }
    throw new Error('Kunde inte läsa ' + jsonUrl);
}
