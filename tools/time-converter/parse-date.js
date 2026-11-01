// Datum och tid som text -> tidpunkt. ISO 8601 tolkas här i stället för av Date, som läser en
// tid utan zon som lokal tid men ett ensamt datum som UTC, och 01/02/2026 som 2 januari.
// Utan zon i texten gäller datorns zon vid just den tidpunkten, och det sägs i svaret.
// Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    var ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|UTC|GMT|[+\-]\d{2}(?::?\d{2})?)?$/i;

    function pad(n) { return String(n).padStart(2, '0'); }

    function offsetLabel(minutes) {
        var abs = Math.abs(minutes);
        return 'UTC' + (minutes < 0 ? '-' : '+') + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
    }

    // Returnerar { date, zone, assumed } eller { error } eller null (inget datum alls).
    // zone: 'UTC' eller 'UTC+02:00' när zonen står i texten; assumed: true när datorns zon antogs.
    function parseDateText(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return null;
        var m = ISO.exec(s);
        if (m) {
            var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
            var h = Number(m[4] || 0), mi = Number(m[5] || 0), sec = Number(m[6] || 0);
            var ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0;
            if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return { error: 'Datumet eller klockslaget finns inte.' };
            var check = new Date(Date.UTC(y, mo - 1, d));
            if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return { error: 'Datumet finns inte.' };
            var zone = m[8] || '';
            if (/^(Z|UTC|GMT)$/i.test(zone)) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms)), zone: 'UTC', assumed: false };
            if (zone) {
                var zm = /^([+\-])(\d{2}):?(\d{2})?$/.exec(zone);
                var off = (zm[1] === '-' ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3] || 0));
                if (Math.abs(off) > 14 * 60) return { error: 'Tidszonen ' + zone + ' finns inte.' };
                return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms) - off * 60000), zone: offsetLabel(off), assumed: false };
            }
            // Ingen zon: datorns zon, med sommartid efter datumet.
            return { date: new Date(y, mo - 1, d, h, mi, sec, ms), zone: null, assumed: true, dateOnly: m[4] == null };
        }
        if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/.test(s)) {
            return { error: 'Ett datum som 01/02/2026 kan betyda både 1 februari och 2 januari. Skriv datumet som ÅÅÅÅ-MM-DD.' };
        }
        // Andra skrivsätt (till exempel "Sat, 31 Oct 2026 14:30:00 GMT") godtas bara med zon.
        var other = new Date(s);
        if (isNaN(other.getTime())) return null;
        if (!/\b(GMT|UTC)\b|Z$|[+\-]\d{2}:?\d{2}\b/.test(s)) {
            return { error: 'Datumet saknar tidszon. Skriv det som ÅÅÅÅ-MM-DD TT:MM:SS, med Z eller +01:00 efter om zonen är känd.' };
        }
        return { date: other, zone: 'angiven i texten', assumed: false };
    }

    var api = { parseDateText: parseDateText, offsetLabel: offsetLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TimeParse = api;
})(typeof window !== 'undefined' ? window : this);
