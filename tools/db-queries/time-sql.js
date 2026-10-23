// Tidsspannet skrivs in i SQL:en som datum och tid med zon, t.ex.
// CAST(strftime('%s', '2026-03-04 00:00:00+01:00') AS INTEGER), så att användaren kan läsa
// av vad queryn söker på. SQLite räknar om till sekunder själv, oberoende av datorns tidszon.
// strftime('%s') används i stället för unixepoch(), som saknas i äldre DB Browser. Testas i Node.
(function (root) {
    'use strict';

    var COCOA_EPOCH = 978307200;
    // Tomt fält betyder ingen gräns. Gränserna ligger långt utanför all data.
    var OPEN_START = '1970-01-01 00:00:00+00:00';
    var OPEN_END = '2100-01-01 00:00:00+00:00';

    function pad(n) { return String(n).padStart(2, '0'); }

    function offsetText(minutes) {
        var sign = minutes < 0 ? '-' : '+';
        var abs = Math.abs(minutes);
        return sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
    }

    // Datum utan klockslag: Från blir 00:00:00 och Till 23:59:59, så att hela dagen kommer med.
    // Unixtid (10 eller 13 siffror) skrivs om till UTC. Annars gäller datorns tidszon.
    function parse(raw, isEnd) {
        var t = String(raw == null ? '' : raw).trim();
        if (!t) return null;
        if (/^\d{10}$|^\d{13}$/.test(t)) {
            var unix = t.length === 13 ? Math.floor(Number(t) / 1000) : Number(t);
            var d = new Date(unix * 1000);
            return {
                unix: unix,
                text: d.toISOString().slice(0, 19).replace('T', ' '),
                offset: '+00:00',
            };
        }
        var s = t.replace(/\//g, '-');
        var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
        if (!m) return null;
        var hasTime = m[4] !== undefined;
        var h = hasTime ? Number(m[4]) : (isEnd ? 23 : 0);
        var min = hasTime ? Number(m[5]) : (isEnd ? 59 : 0);
        var sec = hasTime ? Number(m[6] || 0) : (isEnd ? 59 : 0);
        if (h === 24 && min === 0 && sec === 0) { h = 23; min = 59; sec = 59; }
        var local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, sec);
        if (isNaN(local.getTime()) || local.getDate() !== Number(m[3]) || h > 23 || min > 59 || sec > 59) return null;
        return {
            unix: Math.floor(local.getTime() / 1000),
            text: m[1] + '-' + m[2] + '-' + m[3] + ' ' + pad(local.getHours()) + ':' + pad(local.getMinutes()) + ':' + pad(local.getSeconds()),
            offset: offsetText(-local.getTimezoneOffset()),
        };
    }

    function literal(parsed, isEnd) {
        return parsed ? parsed.text + parsed.offset : (isEnd ? OPEN_END : OPEN_START);
    }

    // kind: 'cocoa' (sekunder sedan 2001), 'unix' (sekunder sedan 1970) eller 'unixMs'.
    function expr(kind, lit) {
        var base = "CAST(strftime('%s', '" + lit + "') AS INTEGER)";
        if (kind === 'cocoa') return '(' + base + ' - ' + COCOA_EPOCH + ')';
        if (kind === 'unixMs') return '(' + base + ' * 1000)';
        return base;
    }

    var api = { parse: parse, literal: literal, expr: expr, OPEN_START: OPEN_START, OPEN_END: OPEN_END, COCOA_EPOCH: COCOA_EPOCH };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TimeSql = api;
})(typeof window !== 'undefined' ? window : this);
