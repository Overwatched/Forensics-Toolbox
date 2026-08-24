(function () {
    'use strict';

    /**
     * CyberChef läser ?theme= från URL:en som sitt eget temanamn (classic/dark/…).
     * Toolbox skickar light/dark på samma parameter — light är ogiltigt i CyberChef
     * och faller då tillbaka till OS prefers-color-scheme (ofta dark).
     * Skriv om light → classic innan CyberChef bootar, och följ live-växling via postMessage.
     */
    function chefTheme(toolboxTheme) {
        return toolboxTheme === 'light' ? 'classic' : 'dark';
    }

    function readToolboxTheme() {
        try {
            var params = new URLSearchParams(location.search);
            var t = params.get('theme');
            if (t === 'light' || t === 'classic' || t === 'solarizedLight') return 'light';
            if (t === 'dark' || t === 'solarizedDark' || t === 'geocities') return 'dark';
        } catch (e) { /* ignoreras */ }
        try {
            var saved = localStorage.getItem('theme');
            if (saved === 'light' || saved === 'dark') return saved;
        } catch (e) { /* ignoreras */ }
        return 'dark';
    }

    function writeChefOptions(theme) {
        try {
            var opts = {};
            try { opts = JSON.parse(localStorage.getItem('options')) || {}; } catch (e) { opts = {}; }
            if (typeof opts !== 'object' || !opts) opts = {};
            opts.theme = theme;
            localStorage.setItem('options', JSON.stringify(opts));
        } catch (e) { /* localStorage kan vara avstängt */ }
    }

    function rewriteChefThemeParam(theme) {
        try {
            var url = new URL(location.href);
            if (url.searchParams.get('theme') === theme) return;
            url.searchParams.set('theme', theme);
            history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch (e) { /* file:// eller sandlåda */ }
    }

    function paint(theme) {
        try { document.documentElement.className = theme; } catch (e) { /* ignoreras */ }
        var select = document.getElementById('theme');
        if (!select) return;
        try { select.value = theme; } catch (e) { /* ignoreras */ }
        if (typeof window.app === 'undefined') return;
        try { select.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignoreras */ }
    }

    function applyChefTheme(toolboxTheme) {
        var theme = chefTheme(toolboxTheme);
        writeChefOptions(theme);
        rewriteChefThemeParam(theme);
        paint(theme);
    }

    applyChefTheme(readToolboxTheme());

    document.addEventListener('DOMContentLoaded', function () {
        paint(chefTheme(readToolboxTheme()));
    });

    window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        var data = event.data;
        if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
        if (data.type === 'theme' && (data.theme === 'light' || data.theme === 'dark')) {
            applyChefTheme(data.theme);
        }
    });
})();
