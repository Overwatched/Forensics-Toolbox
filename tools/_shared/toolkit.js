/**
 * Delat verktygs-skal för Forensics Toolbox.
 *
 * Laddas synkront i <head> före verktygets egen style.css, så att temat är satt
 * innan sidan målas (ingen blink). Ersätter den tema-kod som tidigare dupplicerades
 * i varje verktyg: dels inline-bootstrap i <head>, dels postMessage-lyssnaren i
 * respektive script.js.
 *
 * Temakontrakt (oförändrat mot tidigare beteende):
 *  - Föräldern (Toolbox.html) sätter ?theme=light|dark i iframe-URL:en vid laddning.
 *  - Live-byten skickas via postMessage { source: 'forensics-toolbox', type: 'theme', theme }.
 *  - Faller tillbaka på sparat värde i localStorage, annars mörkt tema.
 */
(function () {
    function isTheme(value) {
        return value === 'light' || value === 'dark';
    }

    function storeTheme(theme) {
        try {
            localStorage.setItem('theme', theme);
        } catch (e) {
            /* localStorage otillgängligt (t.ex. privat läge) — temat gäller ändå för sessionen */
        }
    }

    function applyTheme(theme) {
        if (!isTheme(theme)) return;
        document.documentElement.setAttribute('data-theme', theme);
        storeTheme(theme);
    }

    // 1. Initialt tema: förälderns ?theme= först, annars sparat värde, annars mörkt.
    try {
        var params = new URLSearchParams(location.search);
        var fromParent = params.get('theme');
        var saved = localStorage.getItem('theme');
        var theme = isTheme(fromParent) ? fromParent : (isTheme(saved) ? saved : 'dark');
        document.documentElement.setAttribute('data-theme', theme);
        if (isTheme(fromParent)) storeTheme(fromParent);
    } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // 2. Live-temabyten från föräldern (klick på temaväxlaren i Toolbox.html).
    window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        var data = event.data;
        if (data && (data.source === 'forensics-toolbox' || data.source === 'verktygslada') &&
            data.type === 'theme') {
            applyTheme(data.theme);
        }
    });
})();
