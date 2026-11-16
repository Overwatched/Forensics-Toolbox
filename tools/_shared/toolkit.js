/**
 * Delat verktygs-skal för Forensics Toolbox.
 *
 * Laddas synkront i <head> före verktygets egen style.css, så att temat är satt
 * innan sidan målas (ingen blink). Ersätter den tema-kod som annars dupliceras
 * i varje verktyg: dels inline-bootstrap i <head>, dels postMessage-lyssnaren i
 * respektive script.js.
 *
 * Temakontrakt (oförändrat mot tidigare beteende):
 *  - Föräldern (Toolbox.html) sätter ?theme=light|dark i iframe-URL:en vid laddning.
 *  - Live-byten skickas via postMessage { source: 'forensics-toolbox', type: 'theme', theme }.
 *  - Faller tillbaka på sparat värde i localStorage, annars mörkt tema.
 *
 * Verktyg som även lyssnar på andra meddelanden (t.ex. select-db, select-format)
 * behåller sin egen lyssnare för dem — det här skalet sköter bara temat.
 */
// Besked när webbläsaren saknar WebAssembly, tom text annars. Det som läser databaser och EXIF behöver det.
window.toolboxWasmProblem = function () {
    if (typeof WebAssembly !== 'undefined') return '';
    return 'WebAssembly är avstängt i den här webbläsaren, så filen går inte att läsa. Det beror oftast på att JIT är blockerad i Edge ' +
        '(förstärkt säkerhet, eller policyerna EnhanceSecurityMode och DefaultJavaScriptJitSetting under edge://policy). ' +
        'Be den som ansvarar för datorn att tillåta JIT här, eller använd skrivbordsappen.';
};

// Det som står kvar i verktyget när extraktionen byts eller stängs. Huvudfönstret frågar (holds-ask) med
// extraktionen som gäller nu, och verktyget svarar (holds) med det det visar som inte hör till den.
// describe({ file, force }) -> { items: [text], own }. force: verktyget följer bytet även om det visar något.
// own: verktyget skriver själv ut vad det som står kvar hör till. Efter frågan säger verktyget också till när
// svaret ändras, till exempel när vyn töms med verktygets egen knapp.
window.toolboxHolds = function (describe) {
    if (window.parent === window) return;
    var asked = null;
    var sent = '';
    function answer(id) {
        var d = describe(asked) || {};
        var items = (d.items || []).map(String);
        sent = items.join('\n');
        window.parent.postMessage({ source: 'forensics-toolbox', type: 'holds', id: id, items: items, own: !!d.own }, '*');
    }
    window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        var data = event.data;
        if (!data || data.source !== 'forensics-toolbox' || data.type !== 'holds-ask') return;
        asked = { file: data.file || null, force: !!data.force };
        answer(data.id);
    });
    var timer = null;
    function later() {
        if (!asked || timer) return;
        timer = setTimeout(function () {
            timer = null;
            // Det som händer efter frågan gör undersökaren själv: då följer inget verktyg ett byte på egen hand.
            asked.force = false;
            var d = describe(asked) || {};
            if ((d.items || []).map(String).join('\n') !== sent) answer(null);
        }, 300);
    }
    ['click', 'change', 'drop'].forEach(function (type) { document.addEventListener(type, later, true); });
};

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
