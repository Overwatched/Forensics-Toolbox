/**
 * Ladda lokal JSON. Kopian i motsvarande .js-fil (t.ex. catalog.js) går först: webbläsare som
 * öppnar Toolbox.html via file:// blockerar fetch() och skriver ett rött fel i konsolen för varje
 * försök. Testerna ser till att kopian är lika med .json-filen. fetch() används bara utan kopia.
 */
async function loadLocalJson(jsonUrl, globalName) {
    if (globalName && typeof window[globalName] !== 'undefined') {
        return window[globalName];
    }
    const res = await fetch(jsonUrl);
    if (res.ok) return await res.json();
    throw new Error('Kunde inte läsa ' + jsonUrl);
}
