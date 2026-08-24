(function (root) {
    'use strict';

    var GROUPS = [
        { id: 'forensik', label: 'Forensikverktyg' },
        { id: 'samling', label: 'Samlingslänkar' },
    ];

    var TOOLS = [
        {
            id: 'aleapp',
            name: 'ALEAPP',
            desc: 'Android artifact parsing (Abrignoni)',
            url: 'https://github.com/abrignoni/ALEAPP',
            group: 'forensik',
            initials: 'AL',
            color: '#34c759',
        },
        {
            id: 'autopsy',
            name: 'Autopsy',
            desc: 'Disk-/image-forensik',
            url: 'https://www.autopsy.com/',
            group: 'forensik',
            initials: 'AU',
            color: '#ff453a',
        },
        {
            id: 'dbbrowser',
            name: 'DB Browser for SQLite',
            desc: 'Öppna och query:a SQLite-databaser',
            url: 'https://sqlitebrowser.org/',
            group: 'forensik',
            initials: 'DB',
            color: '#0a84ff',
        },
        {
            id: 'exiftool',
            name: 'ExifTool',
            desc: 'Metadata i bilder och andra filer',
            url: 'https://exiftool.org/',
            group: 'forensik',
            initials: 'EX',
            color: '#ff9f0a',
        },
        {
            id: 'ileapp',
            name: 'iLEAPP',
            desc: 'iOS artifact parsing (Abrignoni)',
            url: 'https://github.com/abrignoni/iLEAPP',
            group: 'forensik',
            initials: 'iL',
            color: '#64d2ff',
        },
        {
            id: 'passware',
            name: 'Passware Kit Forensic',
            desc: 'Senaste noterade: 2026 v3',
            url: 'https://www.passware.com/kit-forensic/',
            group: 'forensik',
            initials: 'PW',
            color: '#bf5af2',
        },
        {
            id: 'startme',
            name: 'Forensics start.me',
            desc: 'Samlingsida med forensikresurser',
            url: 'https://start.me/p/q6mw4Q/forensics',
            group: 'samling',
            initials: 'SM',
            color: '#30d158',
        },
        {
            id: 'osint4all',
            name: 'OSINT4ALL',
            desc: 'Kollektion av OSINT-verktyg',
            url: 'https://start.me/p/L1rEYQ/osint4all',
            group: 'samling',
            initials: 'OS',
            color: '#ff9f0a',
        },
        {
            id: 'sans',
            name: 'SANS Tools',
            desc: 'Forensik- och DFIR-resurser',
            url: 'https://www.sans.org/tools/',
            group: 'samling',
            initials: 'SA',
            color: '#0a84ff',
        },
    ];

    function normalize(text) {
        return String(text || '').toLowerCase().trim();
    }

    function matches(tool, query) {
        var q = normalize(query);
        if (!q) return true;
        var hay = [tool.name, tool.desc, tool.initials, tool.group].join(' ').toLowerCase();
        return hay.indexOf(q) !== -1;
    }

    function filterTools(query) {
        return TOOLS.filter(function (tool) { return matches(tool, query); });
    }

    var api = {
        GROUPS: GROUPS,
        TOOLS: TOOLS,
        filterTools: filterTools,
        matches: matches,
    };

    root.ExternalTools = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
