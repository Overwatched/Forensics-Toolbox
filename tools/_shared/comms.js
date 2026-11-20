// Samtal och kontakter ur katalogen Meddelanden, samtal och kontakter (queries/comms): rollerna calls, contacts och
// contact-points. Här görs rollernas rader om till samtal och kontakter, och ett nummer slås upp till en kontakt.
// Ingen SQL finns här. Används av Chattar och Telefonen; testas i Node (comms.test.js).
(function (root) {
    'use strict';

    var Roles = typeof module !== 'undefined' && module.exports ? require('../provenance/roles.js') : root.ProvenanceRoles;
    var ROLES = { calls: 'calls', contacts: 'contacts', points: 'contact-points' };

    // Databaserna i katalogen som har samtal eller kontakter: { key, platform, title, label, paths, kind, roles }.
    function sources(catalog) {
        var out = [];
        ((catalog && catalog.databases) || []).forEach(function (db) {
            var roles = {};
            Object.keys(ROLES).forEach(function (k) {
                var q = (db.queries || []).filter(function (x) { return x.hidden && x.role === ROLES[k]; })[0];
                if (q) roles[k] = q;
            });
            var kind = roles.calls ? 'calls' : roles.contacts ? 'contacts' : null;
            if (!kind) return;
            var m = /^(iOS|Android) — (.*)$/.exec(db.label || '');
            out.push({ key: db.id, platform: m ? m[1] : db.os || '', title: m ? m[2] : db.label, label: db.label, paths: db.paths || [], kind: kind, roles: roles });
        });
        return out;
    }
    // I den form ExtractionCore.targets() vill ha.
    function databases(list) {
        return list.map(function (s) { return { id: s.key, family: s.key, familyTitle: s.title, label: s.title, paths: s.paths, ios: null, cipher: null, derive: null }; });
    }

    function text(v) { return v === null || v === undefined ? '' : String(v); }
    function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }

    // Ett nummer som nyckel: de nio sista siffrorna, så att 070-123 45 67, +46701234567 och 0046701234567 blir
    // samma. Kortare än sju siffror (eller bokstäver som SIGNAL) ger ingen nyckel. En e-postadress med gemener.
    function phoneKey(v) {
        var s = text(v).trim();
        if (!s) return '';
        if (s.indexOf('@') > 0 && !/@s\.whatsapp\.net$|@c\.us$|@lid$/.test(s)) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : '';
        s = s.replace(/@.*$/, '');
        if (/[a-z]/i.test(s.replace(/^tel:/i, ''))) return '';
        var d = s.replace(/\D/g, '');
        return d.length >= 7 ? d.slice(-9) : '';
    }

    // Kontakterna: { list, index }. index: nyckel -> kontakt. Rader ur rollerna contacts och contact-points.
    function contacts(src, contactResult, pointResult) {
        var cq = src.roles.contacts, pq = src.roles.points;
        var byId = {}, list = [];
        Roles.mapRows(cq, contactResult, ['created', 'modified', 'lastContacted']).forEach(function (r) {
            var c = {
                id: text(r.id), name: text(r.name).replace(/\s+/g, ' ').trim(), first: text(r.first), last: text(r.last), nick: text(r.nick), org: text(r.org), title: text(r.title),
                note: text(r.note), birthday: text(r.birthday), createdMs: r.createdMs || null, modifiedMs: r.modifiedMs || null, account: text(r.account),
                starred: num(r.starred) === 1, contacted: num(r.contacted), lastContactedMs: r.lastContactedMs || null, deleted: num(r.deleted) === 1,
                phones: [], emails: [],
            };
            byId[c.id] = c;
            list.push(c);
        });
        if (pq && pointResult) {
            Roles.mapRows(pq, pointResult, []).forEach(function (r) {
                var c = byId[text(r.contactId)];
                var v = text(r.value).trim();
                if (!c || !v) return;
                var to = r.kind === 'phone' ? c.phones : c.emails;
                if (to.some(function (x) { return x.value === v; })) return;
                to.push({ label: text(r.label), value: v, account: text(r.account) });
            });
        }
        list.forEach(function (c) {
            if (!c.name) c.name = c.org || c.nick || (c.phones[0] ? c.phones[0].value : c.emails[0] ? c.emails[0].value : 'Utan namn');
            c.sortName = c.name.toLocaleLowerCase('sv');
        });
        list.sort(function (a, b) { return a.sortName.localeCompare(b.sortName, 'sv'); });
        return { list: list, index: indexOf(list) };
    }
    function indexOf(list) {
        var index = {};
        list.forEach(function (c) {
            c.phones.concat(c.emails).forEach(function (p) {
                var k = phoneKey(p.value);
                // Två kontakter med samma nummer: den första behålls, och numret märks som delat.
                if (k && !index[k]) index[k] = c;
                else if (k && index[k] !== c) index[k].shared = true;
            });
        });
        return index;
    }
    function lookup(index, v) {
        var k = phoneKey(v);
        return k && index ? index[k] || null : null;
    }

    var DIRECTION = { in: 'Inkommande', out: 'Utgående', missed: 'Missat', voicemail: 'Röstbrevlåda', rejected: 'Avvisat', blocked: 'Blockerat', elsewhere: 'Besvarat på annan enhet', other: 'Annat' };

    // Samtalen, det senaste först: { id, ms, duration, number, name, direction, dirText, type, app, others, … }.
    function calls(src, result) {
        return Roles.mapRows(src.roles.calls, result, ['time']).map(function (r) {
            var dir = DIRECTION[r.direction] ? r.direction : 'other';
            var number = text(r.number);
            var others = text(r.others).split(/,\s*/).filter(function (x) { return x && x !== number; });
            return {
                id: text(r.id), ms: r.timeMs || null, raw: r.time, duration: num(r.duration), number: number, name: text(r.name), direction: dir, dirText: DIRECTION[dir],
                answered: num(r.answered), type: text(r.type), app: text(r.app), others: others, country: text(r.country), place: text(r.place), read: num(r.read),
                cause: num(r.cause), uid: text(r.uid), hidden: text(r.hidden), account: text(r.account), typeRaw: num(r.typeRaw),
            };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    // 0:07, 1:05, 1:02:03.
    function durationText(s) {
        if (s === null || s === undefined || !isFinite(s)) return '';
        var t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
    }

    var api = { sources: sources, databases: databases, phoneKey: phoneKey, contacts: contacts, indexOf: indexOf, lookup: lookup, calls: calls, durationText: durationText, DIRECTION: DIRECTION };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Comms = api;
})(typeof window !== 'undefined' ? window : this);
