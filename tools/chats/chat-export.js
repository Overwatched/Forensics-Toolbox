// Export ur Chattar: en fristående HTML-fil med de valda meddelandena som bubblor, bilderna inbäddade, och
// överst varifrån de kommer. Samma HTML skrivs ut till PDF. Sist står en tabell med varje meddelandes id,
// råa tider och bilagornas sökväg och SHA-256, så att varje rad går att hitta i databasen. En stor export byggs
// i delar (parts) med förlopp, och estimate säger i förväg ungefär hur stor den blir. Med look 'phone' står
// bubblorna i en ram med en telefons bredd, märkt som rekonstruktion. Testas i Node.
(function (root) {
    'use strict';

    var Core = typeof module !== 'undefined' && module.exports ? require('./chat-core.js') : root.ChatCore;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Text med radbrytningar som i appen.
    function body(s) { return esc(s).replace(/\r?\n/g, '<br>'); }

    var CSS = [
        '*{box-sizing:border-box}',
        'body{font:13px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;background:#fff;margin:24px auto;max-width:820px;padding:0 16px}',
        'h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}',
        '.lead{color:#555;margin:0 0 14px}',
        'table.meta{border-collapse:collapse;width:100%;margin:0 0 6px}table.meta th{text-align:left;font-weight:600;color:#444;width:28%;vertical-align:top;padding:3px 8px 3px 0}table.meta td{padding:3px 0;word-break:break-word}',
        '.people{margin:0;padding-left:18px}',
        '.day{text-align:center;margin:18px 0 8px}.day span{display:inline-block;background:#eef0f3;color:#444;border-radius:10px;padding:2px 10px;font-size:12px}',
        '.msg{display:flex;flex-direction:column;align-items:flex-start;margin:6px 0;page-break-inside:avoid;break-inside:avoid}',
        '.msg.me{align-items:flex-end}',
        '.bubble{max-width:72%;border-radius:14px;padding:7px 11px;background:#f0f0f2;border:1px solid #e2e2e6}',
        '.msg.me .bubble{background:#dcf8c6;border-color:#c7e9ae}',
        '.who{font-size:11.5px;font-weight:600;color:#3a6ea5;margin-bottom:2px}',
        '.txt{white-space:normal;word-break:break-word}',
        '.media img{display:block;max-width:100%;max-height:420px;border-radius:8px;margin:2px 0}',
        '.file{border:1px dashed #b9b9c0;border-radius:8px;padding:6px 8px;margin:2px 0;font-size:12px;color:#333}',
        '.meta-line{font-size:11px;color:#666;margin-top:3px;text-align:right}',
        '.flag{display:inline-block;font-size:10.5px;border:1px solid #bbb;border-radius:8px;padding:0 6px;margin:0 4px 2px 0;color:#444}',
        '.reply{border-left:3px solid #8aa9c9;padding:2px 8px;margin:0 0 4px;font-size:12px;color:#444;background:rgba(0,0,0,.03)}',
        '.sys{align-items:center}.sys .bubble{background:#fff8e1;border-color:#f0e0a8;font-size:12px;color:#5b4a12;text-align:center}',
        'table.trace{border-collapse:collapse;width:100%;font-size:11px}table.trace th,table.trace td{border:1px solid #ddd;padding:3px 5px;text-align:left;vertical-align:top;word-break:break-word}table.trace th{background:#f5f5f7}',
        '.small{font-size:11px;color:#666}',
        '@media print{body{margin:0;max-width:none}.bubble{max-width:78%}h2{page-break-after:avoid}}',
    ].join('\n');

    // Det som står i ramen där appen har sin skrivrad, och på varje utskriven sida.
    var PHONE_LABEL = 'Rekonstruktion ur databasen – inte en skärmbild';

    // Ramen som bild i kanten, med märkningen i sin fot. En utskrift delar remsan i spalter och sidor, och kanten
    // ritas om i varje del (en bakgrundsbild gör det inte): då står märkningen längst ned i varje del och inte bara
    // sist i remsan. Måtten är tiondels px vid 16 px text och följer ramens mått i em nedan: hörnets radie, kantens
    // bredd, och foten på 1,9 em.
    function frameImage(radius, border) {
        var W = 4144, H = 2000, band = 304, top = H - border - band;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="414.4" height="200" viewBox="0 0 ' + W + ' ' + H + '">' +
            '<clipPath id="i"><rect x="' + border + '" y="' + border + '" width="' + (W - 2 * border) + '" height="' + (H - 2 * border) + '" rx="' + (radius - border) + '"/></clipPath>' +
            '<g clip-path="url(#i)"><rect y="' + top + '" width="' + W + '" height="' + (band + border) + '" fill="#f6f6f7"/><rect y="' + top + '" width="' + W + '" height="10" fill="#d8d8dc"/></g>' +
            '<text x="' + W / 2 + '" y="' + (top + band / 2 + 42) + '" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="120" fill="#555">' + esc(PHONE_LABEL) + '</text>' +
            '<rect x="' + border / 2 + '" y="' + border / 2 + '" width="' + (W - border) + '" height="' + (H - border) + '" rx="' + (radius - border / 2) + '" fill="none" stroke="#111114" stroke-width="' + border + '"/></svg>';
        return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    }

    // Telefonvyn: bubblorna i en ram med en telefons bredd (omkring 390 punkter vid 16 px text). Måtten står i em,
    // så att en utskrift blir mindre med samma radbrytningar och får två remsor i bredd på A4. Ramen ritas om i
    // varje spalt och på varje sida (box-decoration-break), med märkningen i sin fot. Bakgrunderna skrivs alltid ut
    // (print-color-adjust): vit text på en färgad bubbla får aldrig stå utan sin färg. Numret utanför ramen är raden
    // i spårbarheten.
    var PHONE_CSS = [
        '.strip{font-size:16px;margin:14px 0 8px}',
        '.phone{--bg:#ece5dd;--them:#fff;--me:#d9fdd3;--me-text:#111b21;width:25.9em;max-width:calc(100% - 6em);margin:0 auto;padding:.9em 0 1.9em;border:.65em solid #111114;border-radius:3em;' +
            'border-image:' + frameImage(480, 104) + ' 48/3em;background:var(--bg);' +
            'color:#111b21;line-height:1.35;-webkit-box-decoration-break:clone;box-decoration-break:clone;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
        '.phone[data-app="Signal"]{--bg:#fff;--them:#e9e9eb;--me:#2c6bed;--me-text:#fff}',
        '.phone[data-app="Telegram"]{--bg:#c8d6e5;--me:#e3fee0}',
        '.phone-head{display:flex;align-items:center;gap:.6em;position:relative;margin:-.9em 0 .5em;padding:2.9em .9em .55em;background:#f6f6f7;border-bottom:1px solid #d8d8dc;border-radius:2.35em 2.35em 0 0;break-inside:avoid;break-after:avoid}',
        '.phone-head::before{content:"";position:absolute;top:.6em;left:50%;margin-left:-3.2em;width:6.4em;height:1.75em;border-radius:1em;background:#111114}',
        '.phone.android{border-width:.55em;border-radius:2.2em;border-image:' + frameImage(352, 88) + ' 40/2.5em}',
        '.phone.android .phone-head{padding-top:2.2em;border-radius:1.65em 1.65em 0 0}',
        '.phone.android .phone-head::before{top:.65em;margin-left:-.45em;width:.9em;height:.9em;border-radius:50%}',
        '.phone.plain .phone-head{padding-top:1.4em}.phone.plain .phone-head::before{display:none}',
        '.avatar{flex:none;width:2.25em;height:2.25em;border-radius:50%;background:#b9bcc4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600}',
        '.phone-names{min-width:0;display:flex;flex-direction:column}',
        '.phone-names b,.phone-names small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phone-names small{font-size:.75em;color:#666}',
        '.phone-body{padding:0 .6em .4em}',
        '.phone-foot{display:flex;align-items:center;justify-content:center;height:1.9em;margin:0 0 -1.9em;background:#f6f6f7;border-top:1px solid #d8d8dc;border-radius:0 0 2.35em 2.35em;color:#555;break-inside:avoid;break-before:avoid}',
        '.phone-foot span{font-size:.75em}',
        '.phone.android .phone-foot{border-radius:0 0 1.65em 1.65em}',
        '.phone .day{margin:.7em 0 .4em}.phone .day span{font-size:.75em;background:rgba(255,255,255,.88);border:1px solid rgba(0,0,0,.08)}',
        '.phone .msg{position:relative;margin:.25em 0}',
        '.phone .bubble{max-width:78%;border-radius:1.1em;padding:.4em .7em .3em;background:var(--them);border-color:rgba(0,0,0,.1)}',
        '.phone .msg.me .bubble{background:var(--me);color:var(--me-text);border-color:rgba(0,0,0,.1)}',
        '.phone .sys .bubble{max-width:88%;background:#fff8e1;border-color:#f0e0a8;font-size:.78em;color:#5b4a12}',
        '.phone .who{font-size:.8em}.phone .msg.me .who{color:inherit}',
        '.phone .media img{max-height:20em;border-radius:.6em}',
        '.phone .file,.phone .reply{font-size:.8em;color:inherit}.phone .file{border-color:currentColor;overflow-wrap:anywhere}',
        '.phone .small{font-size:.85em;color:inherit;opacity:.8}',
        '.phone .flag{font-size:.66em;color:inherit;border-color:currentColor}',
        '.phone .meta-line{font-size:.7em;color:inherit;opacity:.72;margin-top:.15em}',
        '.no{position:absolute;top:.75em;right:100%;margin-right:2.36em;font-size:.7em;color:#666;white-space:nowrap}',
        '@page{@bottom-center{content:"Telefonvyn i den här exporten är en rekonstruktion ur databasen, ingen skärmbild.";font:8pt -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#555}}',
        '@media print{.strip{font-size:11px;columns:29.1em;column-gap:1em}.phone{max-width:none;margin:0 0 0 3.2em}.no{font-size:.8em;margin-right:2.06em}}',
    ].join('\n');

    // Första tecknet i namnet, för ringen i ramens huvud. Ett nummer får #.
    function initial(name) {
        var first = Array.from(String(name || '').trim())[0] || '';
        return /[0-9+]/.test(first) ? '#' : first.toUpperCase() || '?';
    }

    // Det som står i telefonvyns ram, på skärmen och i exporten: ramen efter plattformen, och i huvudet bara det
    // databasen har om konversationen. Ingen klocka, mottagning eller batterinivå ritas: de finns inte i databasen.
    function phoneFrame(model) {
        var t = model.thread, p = model.source.platform;
        return {
            frame: p === 'iOS' ? 'ios' : p === 'Android' ? 'android' : 'plain',
            initial: initial(t.name), name: t.name,
            sub: model.group ? t.kindText + ' · ' + (model.members.length + 1) + ' deltagare' : t.address && t.address !== t.name ? t.address : t.kindText,
            label: PHONE_LABEL,
        };
    }

    function attachmentHtml(a, media, fmt) {
        var src = media && media[a.entry] ? media[a.entry] : null;
        var name = a.name || (a.entry ? a.entry.slice(a.entry.lastIndexOf('/') + 1) : '');
        if (a.kind === 'contact') return '<div class="file">Kontaktkort: ' + esc(a.cardName || '') + (a.card ? '<br><span class="small">' + body(a.card) + '</span>' : '') + '</div>';
        if (a.kind === 'location') return '<div class="file">Plats: ' + esc(a.lat) + ', ' + esc(a.lon) + '</div>';
        if ((a.kind === 'image' || a.kind === 'sticker') && src && src.dataUrl) {
            return '<div class="media"><img src="' + esc(src.dataUrl) + '" alt="' + esc(name) + '">' + (src.smaller ? '<div class="small">Bara en mindre version fanns i extraktionen.</div>' : '') + '</div>';
        }
        var what = { image: 'Bild', sticker: 'Klistermärke', video: 'Video', audio: 'Ljud', voice: 'Röstmeddelande', gif: 'GIF' }[a.kind] || 'Fil';
        var parts = [name, a.mime, Core.durationText(a.duration), Core.sizeText(a.size)].filter(Boolean);
        var missing = !a.entry ? ' Databasen har ingen sökväg till filen.' : src && src.missing ? ' Filen finns inte i extraktionen.' : '';
        return '<div class="file">' + esc(what) + ': ' + esc(parts.join(', ')) + (a.sha256 ? '<br><span class="small">SHA-256 ' + esc(a.sha256) + '</span>' : '') + esc(missing) + '</div>';
    }

    function flagsHtml(m) {
        var f = [];
        if (m.viewOnce) f.push('engångsvisning');
        if (m.deleted) f.push('raderat');
        if (m.edited) f.push(m.edited);
        if (m.expiresIn) f.push('försvinner efter ' + m.expiresIn + ' s');
        if (m.device) f.push(m.device);
        return f.map(function (x) { return '<span class="flag">' + esc(x) + '</span>'; }).join('');
    }

    // no: radens nummer i spårbarheten, i telefonvyn. Där står bara klockslaget i bubblan, som i appen, och numret
    // leder till raden med id och alla tider.
    function messageHtml(m, model, fmt, media, no) {
        var phone = no !== undefined;
        var sys = m.kind === 'system' || m.kind === 'call';
        var who = model.group && !m.fromMe && !sys ? '<div class="who">' + esc(Core.senderText(m)) + '</div>' : '';
        var reply = m.reply ? '<div class="reply">Svar på ' + esc(m.reply.from || 'ett meddelande') + (m.reply.text ? ': ' + esc(m.reply.text) : m.reply.found ? '' : ' (finns inte i databasen)') + '</div>' : '';
        var txt = m.text ? '<div class="txt">' + body(m.text) + '</div>' : '';
        var label = !m.text && !m.attachments.length ? '<div class="txt"><em>' + esc(m.kindLabel) + '</em></div>' : '';
        var files = m.attachments.map(function (a) { return attachmentHtml(a, media, fmt); }).join('');
        var time = m.sortMs !== null ? fmt(m.sortMs) : 'tid saknas';
        if (phone && m.sortMs !== null) time = time.slice(11, 16);
        // I telefonvyn står en systemrad eller ett samtal i mitten också när den är telefonens egen, som i apparna.
        return '<div class="msg' + (m.fromMe && !(phone && sys) ? ' me' : '') + (sys ? ' sys' : '') + '"><div class="bubble">' + who + reply + flagsHtml(m) + files + txt + label +
            '<div class="meta-line">' + esc(time) + (phone ? '' : ' · id ' + esc(m.id)) + '</div></div>' + (phone ? '<span class="no">#' + no + '</span>' : '') + '</div>';
    }

    // Raderna from–to (to ej med) i spårbarhetstabellen, numrerade i hela urvalet.
    function traceRows(list, from, to, fmt) {
        var out = [];
        for (var i = from; i < to; i++) {
            var m = list[i];
            var times = m.times.map(function (t) {
                return esc(t.label) + ': ' + (t.ms !== null && t.ms !== undefined ? esc(fmt(t.ms)) + ' (' + esc(new Date(t.ms).toISOString()) + ')' : 'saknas') + ' — ' + esc(t.col) + ' = ' + esc(t.raw === null || t.raw === undefined ? 'NULL' : t.raw);
            }).join('<br>');
            var files = m.attachments.map(function (a) {
                return esc(a.entry || '(ingen fil)') + (a.sha256 ? '<br>SHA-256 ' + esc(a.sha256) : '');
            }).join('<br>');
            out.push('<tr><td>' + (i + 1) + '</td><td>' + esc(m.id) + '</td><td>' + esc(m.fromMe ? 'skickat' : 'mottaget') + '</td><td>' + esc(Core.senderText(m)) + '</td><td>' + esc(m.kindLabel) +
                '</td><td>' + times + '</td><td>' + (files || '') + '</td></tr>');
        }
        return out.join('');
    }

    // Så många meddelanden skrivs åt gången när exporten byggs i delar.
    var BLOCK = 1000;

    // Exporten som en följd av delar: huvudet, bubblorna i block, spårbarheten i block och slutet.
    // opts: { model, messages (urvalet), zone, selection (text om urvalet), meta: { tool, version, extraction, dbPath, dbLabel, keySource, exportedMs },
    //        media: { sökväg i extraktionen: { dataUrl } eller { missing: true } }, look: 'list' (utan: samma) eller 'phone' }
    function writer(opts) {
        var model = opts.model, list = opts.messages, meta = opts.meta || {};
        var phone = opts.look === 'phone';
        var fmt = Core.formatter(opts.zone);
        var zone = Core.zoneName(opts.zone);
        var t = model.thread;
        var title = model.source.app + ': ' + t.name;
        var first = list.length ? list[0].sortMs : null, last = list.length ? list[list.length - 1].sortMs : null;
        var metaRows = [
            ['App', model.source.app + (model.source.platform ? ' (' + model.source.platform + ')' : '')],
            ['Konversation', t.name + (t.address && t.address !== t.name ? ' — ' + t.address : '') + ' (' + t.kindText + ', id ' + t.id + ')'],
            ['Urval', opts.selection || ''],
        ].concat(phone ? [['Utseende', 'Telefon: en rekonstruktion ur databasen, ingen skärmbild']] : [], [
            ['Meddelanden', list.length + ' av ' + model.messages.length + (first !== null ? ', ' + fmt(first) + ' – ' + fmt(last) : '')],
            ['Tidszon', zone + (first !== null ? ' (UTC' + Core.offsetText(opts.zone, first) + ' vid det första meddelandet)' : '') + '. Tiden i bubblan är ' + (list[0] ? list[0].sortLabel.toLowerCase() : 'meddelandets tid') + '.'],
            ['Extraktion', meta.extraction || ''],
            ['Databas', (meta.dbLabel || model.source.title) + (meta.dbPath ? ' — ' + meta.dbPath : '')],
        ]);
        if (meta.keySource) metaRows.push(['Nyckel', meta.keySource]);
        metaRows.push(['Exporterad', (meta.exportedMs ? new Date(meta.exportedMs).toISOString() : '') + ' med ' + (meta.tool || 'Forensics Toolbox') + (meta.version ? ' ' + meta.version : '') + ', Chattar']);
        var people = model.members.length ? '<ul class="people">' + model.members.map(function (p) {
            return '<li>' + esc(p.name) + (p.address && p.address !== p.name ? ' — ' + esc(p.address) : '') + (p.admin ? ' (administratör)' : '') + (p.active === false ? ' (har lämnat)' : '') + '</li>';
        }).join('') + '<li>Den här telefonen</li></ul>' : '<p class="small">Inga deltagare står i databasen utöver den här telefonen.</p>';
        var ph = phone && list.length ? phoneFrame(model) : null;
        var lead = phone
            ? 'Utdrag ur ' + esc(model.source.app) + 's databas, uppställt som i en telefon. Det är en rekonstruktion och ingen skärmbild: texten och tiderna är lästa ur databasen utan ändringar, ' +
                'men uppställningen och färgerna är verktygets egna. Telefonens textstorlek, tema och appversion är inte kända, så radbrytningar och färger kan ha sett annorlunda ut i telefonen, ' +
                'och profilbilder och bakgrundsbild visas inte. Tiderna är omräknade till ' + esc(zone) + '.'
            : 'Utdrag ur ' + esc(model.source.app) + 's databas. Texten och tiderna är lästa ur databasen utan ändringar; tiderna är omräknade till ' + esc(zone) + '.';
        var open = ph
            ? '<p class="small">Bubblan har klockslaget. Numret till vänster om ramen är meddelandets rad i tabellen Spårbarhet sist, där dess id, alla tider med sekunder och bilagornas sökväg står.</p>' +
                '<div class="strip"><div class="phone ' + ph.frame + '" data-app="' + esc(model.source.app) + '"><div class="phone-head"><span class="avatar">' + esc(ph.initial) + '</span>' +
                '<span class="phone-names"><b>' + esc(ph.name) + '</b><small>' + esc(ph.sub) + '</small></span></div><div class="phone-body">'
            : '';
        var close = ph ? '</div><div class="phone-foot"><span>' + esc(ph.label) + '</span></div></div></div>' : '';
        // Datumet över bubblorna följer med mellan blocken.
        var day = '';
        return {
            count: list.length,
            head: function () {
                return '<!DOCTYPE html>\n<html lang="sv"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + (phone ? '\n' + PHONE_CSS : '') + '</style></head><body>' +
                    '<h1>' + esc(title) + '</h1><p class="lead">' + lead + '</p>' +
                    '<table class="meta">' + metaRows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
                    '<h2>Deltagare</h2>' + people +
                    '<h2>Meddelanden</h2>' + (list.length ? open : '<p class="small">Inga meddelanden i urvalet.</p>');
            },
            bubbles: function (from, to) {
                var out = [];
                for (var i = from; i < to; i++) {
                    var m = list[i];
                    var d = m.sortMs !== null ? fmt(m.sortMs).slice(0, 10) : 'utan tid';
                    if (d !== day) out.push('<div class="day"><span>' + esc(d) + '</span></div>');
                    day = d;
                    out.push(messageHtml(m, model, fmt, opts.media, phone ? i + 1 : undefined));
                }
                return out.join('');
            },
            middle: function () {
                return close + '<h2>Spårbarhet</h2><p class="small">Varje meddelande med id i databasen, alla tider med kolumn och rått värde, och bilagornas sökväg i extraktionen. Tiderna står i ' + esc(zone) + ' och i UTC.</p>' +
                    '<table class="trace"><thead><tr><th>#</th><th>Id</th><th>Riktning</th><th>Avsändare</th><th>Typ</th><th>Tider</th><th>Bilagor</th></tr></thead><tbody>';
            },
            trace: function (from, to) { return traceRows(list, from, to, fmt); },
            foot: function () { return '</tbody></table></body></html>\n'; },
        };
    }

    // Hela exporten som en text. En stor export byggs med parts i stället.
    function html(opts) {
        var w = writer(opts), n = w.count;
        return w.head() + w.bubbles(0, n) + w.middle() + w.trace(0, n) + w.foot();
    }

    // Exporten i delar, för en Blob: en stor chatt blir aldrig en enda text i minnet. onBlock(steg, gjorda, alla)
    // anropas efter varje block ('messages' eller 'trace') och får returnera ett löfte: en paus för sidan, eller
    // ett fel som avbryter.
    async function parts(opts, onBlock) {
        var w = writer(opts), n = w.count, out = [w.head()];
        for (var i = 0; i < n; i += BLOCK) {
            out.push(w.bubbles(i, Math.min(n, i + BLOCK)));
            if (onBlock) await onBlock('messages', Math.min(n, i + BLOCK), n);
        }
        out.push(w.middle());
        for (var j = 0; j < n; j += BLOCK) {
            out.push(w.trace(j, Math.min(n, j + BLOCK)));
            if (onBlock) await onBlock('trace', Math.min(n, j + BLOCK), n);
        }
        out.push(w.foot());
        return out;
    }

    // Ungefär hur stor exporten blir: filen i byte och sidorna i en utskrift på A4. images: bilderna som bäddas in,
    // imageBytes: deras storlek, look: 'phone' för telefonvyn. Uppskattningen är grov och bara till för att varna
    // före en mycket stor export.
    // Kalibrerad mot exporter utskrivna till PDF på A4 i Electron (2026-11-09 och 2026-11-10; inom 10 % utan bilder
    // och 15 % med): i listan tar en bubbla en elftedel av en sida, texten en sida per 4 300 tecken, varje tid i
    // spårbarheten en sextiondel, och en bild (högst 420 px hög) en dryg halv. I telefonvyn står bubblorna i två
    // smala remsor på sidan: en bubbla tar en artondel, texten en sida per 3 700 tecken, varje tid en
    // sextiofemtedel och en bild en åttondel. Filen: 300 byte per meddelande och 80 per tid, texten, och bilderna
    // som base64. Telefonvyn har 6 500 byte stilmall till.
    function estimate(list, images, imageBytes, look) {
        var chars = 0, times = 0, n = list.length, img = images || 0, phone = look === 'phone';
        list.forEach(function (m) { chars += m.text ? m.text.length : 0; times += m.times ? m.times.length : 0; });
        return {
            messages: n, images: img, imageBytes: imageBytes || 0,
            bytes: Math.round(3000 + n * 300 + times * 80 + chars + (imageBytes || 0) * 4 / 3 + (phone ? 6500 + n * 4 : 0)),
            pages: Math.max(1, Math.ceil(phone ? n / 18 + chars / 3700 + times / 65 + img / 8 : n / 11.4 + chars / 4300 + times / 60 + img / 1.9)),
        };
    }

    // Filnamnet för exporten: app, konversation och tid, utan tecken som inte får stå i ett filnamn.
    function fileName(model, ext, nowMs) {
        var d = new Date(nowMs || Date.now());
        var pad = function (n) { return ('0' + n).slice(-2); };
        var name = (model.source.app + '-' + model.thread.name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
        return name + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
    }

    var api = { html: html, parts: parts, estimate: estimate, fileName: fileName, phone: phoneFrame, esc: esc, BLOCK: BLOCK };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChatExport = api;
})(typeof window !== 'undefined' ? window : this);
