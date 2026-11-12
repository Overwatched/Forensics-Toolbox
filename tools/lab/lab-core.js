// Laborationens kärna: byggstenarna, standardflödena, stegens koder, loggen från körningen och tabellen till
// protokollet. Ett flöde är en lista med steg. Varje steg får en kod efter sin plats i listan. Koden skrivs i
// meddelandet eller syns i bilden, så att spåret i enheten kan knytas till raden i tabellen.
// Tiderna är datorns: varje tryck sparar tidpunkten och datorns avstånd till UTC i just det ögonblicket, så att
// tabellen blir densamma oavsett var filen öppnas. Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    var FORMAT = 'forensics-toolbox-laboration';
    var ALL = '*';
    var APPS = ['WhatsApp', 'Signal', 'Telegram', 'Snapchat', 'Messenger', 'Instagram'];
    var LIMITS = { devices: 12, steps: 500, text: 600, name: 80, wait: 24 * 3600, notes: 2000 };
    var SENT = 'när meddelandet är skickat';

    // Byggstenarna. do är instruktionen, done samma sak i förfluten tid för protokollet, press säger när
    // mellanslag trycks. I texterna byts {kod} mot stegets kod, {förra} mot koden före, {app}, {enhet} och {andra}
    // mot appen, enheten och den andra enheten. chat: steget har en motpart. app: appen som föreslås.
    var ACTIONS = [
        { id: 'text', label: 'Skicka text', chat: true, do: 'Skriv {kod} till {andra} och skicka.', done: 'Skickade texten {kod} till {andra} i {app}.', press: SENT },
        { id: 'read', label: 'Öppna chatten, så att meddelandena blir lästa', chat: true, do: 'Lås upp, öppna {app} och chatten med {andra}, så att meddelandena blir lästa.',
            done: 'Öppnade chatten med {andra} i {app}.', press: 'när chatten är öppen' },
        { id: 'reply', label: 'Svara i chatten', chat: true, do: 'Lås upp, öppna chatten med {andra} i {app} och svara {kod}.', done: 'Öppnade chatten med {andra} i {app} och svarade {kod}.', press: SENT },
        { id: 'photo-app', label: 'Bild med appens kamera', chat: true, do: 'Ta en bild av den här skärmen med kameran inne i {app}. Skriv {kod} som bildtext och skicka till {andra}.',
            done: 'Tog en bild med kameran i {app} och skickade den till {andra} med bildtexten {kod}.', press: SENT },
        { id: 'video-app', label: 'Video med appens kamera', chat: true, do: 'Spela in en video på ungefär fem sekunder av den här skärmen med kameran inne i {app}. Skriv {kod} som bildtext och skicka till {andra}.',
            done: 'Spelade in en video med kameran i {app} och skickade den till {andra} med bildtexten {kod}.', press: SENT },
        { id: 'photo-library', label: 'Bild ur enhetens bilder', chat: true, do: 'Skicka den senaste bilden ur enhetens bilder till {andra}, utan att redigera den, med {kod} som bildtext.',
            done: 'Skickade den senaste bilden ur enhetens bilder till {andra} i {app}, med bildtexten {kod}.', press: SENT },
        { id: 'document', label: 'Bild som dokument', chat: true, do: 'Skicka den senaste bilden ur enhetens bilder till {andra} som dokument, inte som bild, med {kod} som text.',
            done: 'Skickade den senaste bilden ur enhetens bilder som dokument till {andra} i {app}, med texten {kod}.', press: SENT },
        { id: 'voice', label: 'Röstmeddelande', chat: true, do: 'Spela in ett röstmeddelande till {andra} och säg koden {kod} högt. Skicka.',
            done: 'Skickade ett röstmeddelande till {andra} i {app} och sade koden {kod}.', press: SENT },
        { id: 'group', label: 'Skapa en grupp', chat: true, do: 'Skapa en grupp med {andra} som deltagare. Ge den namnet {kod} grupp.', done: 'Skapade gruppen {kod} grupp med {andra} i {app}.',
            press: 'när gruppen är skapad' },
        { id: 'group-text', label: 'Skriv i gruppen', chat: true, do: 'Skriv {kod} i gruppen och skicka.', done: 'Skickade texten {kod} i gruppen i {app}.', press: SENT },
        { id: 'group-reply', label: 'Svara i gruppen', chat: true, do: 'Lås upp, öppna gruppen i {app} och svara {kod}. Tacka ja till gruppen om appen frågar.', done: 'Öppnade gruppen i {app} och svarade {kod}.', press: SENT },
        { id: 'text-delete', label: 'Skicka text som ska raderas', chat: true, do: 'Skriv {kod} raderas till {andra} och skicka.', done: 'Skickade texten {kod} raderas till {andra} i {app}.', press: SENT },
        { id: 'delete', label: 'Radera det senaste meddelandet för alla', chat: true, do: 'Radera meddelandet {förra} raderas för alla.', done: 'Raderade meddelandet {förra} raderas för alla i {app}.',
            press: 'när det är raderat' },
        { id: 'call', label: 'Ring utan svar', chat: true, do: 'Ring {andra} med ett röstsamtal i {app}. Låt det ringa i ungefär tio sekunder och lägg på. Svara inte på {andra}.',
            done: 'Ringde {andra} i {app} och lade på utan svar.', press: 'när du har lagt på' },
        { id: 'call-answer', label: 'Ring med svar', chat: true, do: 'Ring {andra} med ett röstsamtal i {app}. Svara på {andra}, vänta ungefär tio sekunder och lägg på.',
            done: 'Ringde {andra} i {app}. Samtalet besvarades och avslutades.', press: 'när samtalet är avslutat' },

        { id: 'photo', label: 'Bild med kameran', app: 'Kamera', do: 'Fotografera den här skärmen så att koden och klockan syns.', done: 'Tog en bild av skärmen med kameran.', press: 'när bilden är tagen' },
        { id: 'video', label: 'Video med kameran', app: 'Kamera', do: 'Spela in en video på ungefär tio sekunder av den här skärmen.', done: 'Spelade in en video av skärmen med kameran.',
            press: 'när inspelningen stoppas' },
        { id: 'screenshot', label: 'Skärmdump med en app framme', needsApp: true, do: 'Öppna {app} och ta en skärmdump.', done: 'Tog en skärmdump med {app} på skärmen.', press: 'när skärmdumpen är tagen' },
        { id: 'edit-date', label: 'Ändra datum på den senaste bilden', app: 'Bilder', do: 'Ändra datum och tid på den senaste bilden till den 1 januari 2020 klockan 12.00.',
            done: 'Ändrade datum och tid på den senaste bilden till 2020-01-01 klockan 12.00.', press: 'när ändringen är sparad' },
        { id: 'open-app', label: 'Öppna en app och låt den stå framme', needsApp: true, do: 'Gå till hemskärmen och öppna {app}. Låt appen stå framme och rör inte enheten.',
            done: 'Öppnade {app} från hemskärmen och lät appen stå framme.', press: 'när appen är öppen' },
        { id: 'home-lock', label: 'Hemskärmen och lås', do: 'Gå till hemskärmen och lås enheten.', done: 'Gick till hemskärmen och låste enheten.', press: 'när skärmen är släckt' },
        { id: 'install', label: 'Installera en app', needsApp: true, do: 'Installera {app}.', done: 'Installerade {app}.', press: 'när appen är installerad' },
        { id: 'uninstall', label: 'Avinstallera en app', needsApp: true, do: 'Avinstallera {app}.', done: 'Avinstallerade {app}.', press: 'när appen är borta' },
        { id: 'lock', label: 'Lås', do: 'Lås enheten och lägg den på bordet.', done: 'Låste enheten.', press: 'när skärmen är släckt' },
        { id: 'unlock', label: 'Lås upp', do: 'Lås upp till hemskärmen.', done: 'Låste upp enheten.', press: 'när hemskärmen visas' },
        { id: 'power-off', label: 'Stäng av', do: 'Stäng av enheten helt.', done: 'Stängde av enheten.', press: 'när skärmen är svart' },
        { id: 'power-on', label: 'Starta utan att låsa upp', do: 'Starta enheten men lås inte upp den.', done: 'Startade enheten utan att låsa upp den.', press: 'när låsskärmen visas' },
        { id: 'flight-on', label: 'Flygplansläge på', do: 'Slå på flygplansläget.', done: 'Slog på flygplansläget.', press: 'när flygplansläget är på' },
        { id: 'flight-off', label: 'Flygplansläge av', do: 'Slå av flygplansläget.', done: 'Slog av flygplansläget.', press: 'när flygplansläget är av' },
        { id: 'zone', label: 'Byt tidszon', app: 'Inställningar', do: 'Stäng av automatisk tidszon och välj New York. Ändra bara zonen, aldrig klockan.',
            done: 'Stängde av automatisk tidszon och valde New York.', press: 'när zonen är bytt' },
        { id: 'zone-back', label: 'Tidszonen tillbaka', app: 'Inställningar', do: 'Slå på automatisk tidszon igen och se att zonen är den rätta.', done: 'Slog på automatisk tidszon igen.',
            press: 'när zonen är tillbaka' },
        { id: 'custom', label: 'Eget steg', do: '', done: '', press: 'när det är gjort' },
    ];
    var ACTION = {};
    ACTIONS.forEach(function (a) { ACTION[a.id] = a; });

    // Standardflödena. kind chat görs en gång per vald app mellan de två enheterna a och b, de övriga en gång.
    // make får c: c.add(byggsten, enhet, motpart, { wait, do, done, press, app }), c.a, c.b, c.devices och c.app.
    var BLOCKS = [
        { id: 'clock-start', label: 'Klockorna i början', desc: 'Varje enhet fotograferar skärmen. Bilden visar datorns klocka, och bildens egna tider visar enhetens.',
            make: function (c) { c.devices.forEach(function (d) { c.add('photo', d); }); } },
        { id: 'chat-text', kind: 'chat', label: 'Text åt båda håll, och läst', desc: 'Skickat, mottaget och läst på båda enheterna.',
            make: function (c) { c.add('text', c.a, c.b); c.add('read', c.b, c.a); c.add('text', c.b, c.a); c.add('read', c.a, c.b); } },
        { id: 'chat-media', kind: 'chat', label: 'Bild, video och röst', desc: 'Bilagor tagna med appens kamera och hämtade ur enhetens bilder.',
            make: function (c) { c.add('photo-app', c.a, c.b); c.add('photo-library', c.b, c.a); c.add('voice', c.a, c.b); c.add('video-app', c.b, c.a); } },
        { id: 'chat-group', kind: 'chat', label: 'Grupp', desc: 'En grupp skapas på den ena enheten och besvaras på den andra.',
            make: function (c) { c.add('group', c.b, c.a); c.add('group-text', c.b, c.a); c.add('group-reply', c.a, c.b); } },
        { id: 'chat-delete', kind: 'chat', label: 'Raderat meddelande', desc: 'Ett meddelande skickas och raderas för alla.',
            make: function (c) { c.add('text-delete', c.a, c.b); c.add('delete', c.a, c.b); } },
        { id: 'chat-call', kind: 'chat', label: 'Samtal', desc: 'Ett samtal utan svar åt ena hållet och ett besvarat åt det andra.',
            make: function (c) { c.add('call', c.a, c.b); c.add('call-answer', c.b, c.a); } },
        { id: 'camera', label: 'Kamera och skärmdump', desc: 'En bild, en video och en skärmdump på varje enhet.',
            make: function (c) { c.devices.forEach(function (d) { c.add('photo', d); c.add('video', d); c.add('screenshot', d, '', { app: c.app }); }); } },
        { id: 'foreground', label: 'En app i förgrunden', desc: 'En app står framme i två minuter på varje enhet.',
            make: function (c) {
                c.devices.forEach(function (d, n) { c.add('open-app', d, '', { app: c.app, wait: n === c.devices.length - 1 ? 120 : 0 }); });
                c.devices.forEach(function (d) { c.add('home-lock', d); });
            } },
        { id: 'lock-power', label: 'Lås och avstängning', desc: 'Låst i fem minuter, avstängd i tio och igång utan att vara upplåst i tre.',
            make: function (c) {
                var last = c.devices.length - 1;
                c.add('lock', ALL, '', { wait: 300, do: 'Se till att alla enheter är låsta och ligger på bordet.', done: 'Alla enheter var låsta.', press: 'när alla är låsta' });
                c.devices.forEach(function (d) { c.add('unlock', d); });
                c.devices.forEach(function (d, n) { c.add('power-off', d, '', { wait: n === last ? 600 : 0 }); });
                c.devices.forEach(function (d, n) { c.add('power-on', d, '', { wait: n === last ? 180 : 0 }); });
                c.devices.forEach(function (d) { c.add('unlock', d, '', { do: 'Lås upp med koden.', done: 'Låste upp enheten med koden, för första gången efter starten.' }); });
            } },
        { id: 'zone', label: 'Tidszon', desc: 'En bild tas medan enheten står i en annan zon. Bara zonen ändras, aldrig klockan.',
            make: function (c) { c.devices.forEach(function (d) { c.add('zone', d); c.add('photo', d); c.add('zone-back', d); }); } },
        { id: 'clock-end', label: 'Klockorna i slutet', desc: 'Samma bild som i början, så att det syns om någon klocka har dragit sig.',
            make: function (c) {
                c.devices.forEach(function (d, n) { c.add('photo', d, '', { wait: n === c.devices.length - 1 ? 120 : 0 }); });
                c.add('flight-on', ALL, '', { do: 'Sätt alla enheter i flygplansläge, eller gör som du brukar inför en extraktion.', done: 'Alla enheter sattes i flygplansläge.', press: 'när alla är klara' });
            } },
    ];

    function pad(n, w) { return String(n).padStart(w || 2, '0'); }
    function clip(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    // Ett ord utan mellanslag som är längre än så får brytas i en tabell, annars blir tabellen bredare än papperet.
    // Texten delas mellan hela tecken, och ingenting läggs till i den.
    var SOFT = 20;
    function softParts(text) {
        var out = [], part = '', run = 0;
        Array.from(String(text == null ? '' : text)).forEach(function (ch) {
            if (/\s/.test(ch)) run = 0;
            else if (++run > SOFT) { out.push(part); part = ''; run = 1; }
            part += ch;
        });
        out.push(part);
        return out;
    }
    function softHtml(text) { return softParts(text).map(esc).join('<wbr>'); }

    // ---------- Flödet ----------

    function cleanPrefix(p) {
        var s = clip(p, 40).replace(/[^A-Za-zÅÄÖåäö]/g, '').slice(0, 3).toUpperCase();
        return s || 'L';
    }

    function emptyFlow(name, prefix, deviceNames) {
        var flow = { name: clip(name, LIMITS.name).trim() || 'Laboration', prefix: cleanPrefix(prefix), devices: [], steps: [], next: 1 };
        (deviceNames || []).slice(0, LIMITS.devices).forEach(function (n) { addDevice(flow, n); });
        return flow;
    }

    function addDevice(flow, name) {
        if (flow.devices.length >= LIMITS.devices) return null;
        var d = { id: 'd' + flow.next++, name: clip(name, LIMITS.name).trim() || 'Enhet ' + (flow.devices.length + 1) };
        flow.devices.push(d);
        return d;
    }

    // Enheten försvinner, och stegen som gjordes på den med den. Ett steg som bara hade den som motpart står kvar.
    function removeDevice(flow, id) {
        flow.devices = flow.devices.filter(function (d) { return d.id !== id; });
        flow.steps = flow.steps.filter(function (s) { return s.device !== id; });
        flow.steps.forEach(function (s) { if (s.other === id) s.other = ''; });
    }

    function hasDevice(flow, id) { return flow.devices.some(function (d) { return d.id === id; }); }

    // Ett steg ur en byggsten. Texterna kopieras till steget, så att de kan ändras och filen förklarar sig själv.
    function makeStep(flow, actionId, o) {
        var a = ACTION[actionId] || ACTION.custom;
        o = o || {};
        return {
            id: 's' + flow.next++, action: a.id, block: clip(o.block, LIMITS.name),
            device: o.device === ALL || hasDevice(flow, o.device) ? o.device : (flow.devices[0] ? flow.devices[0].id : ALL),
            other: hasDevice(flow, o.other) ? o.other : '',
            app: clip(o.app != null && o.app !== '' ? o.app : a.app || '', LIMITS.name).trim(),
            do: clip(o.do != null ? o.do : a.do, LIMITS.text), done: clip(o.done != null ? o.done : a.done, LIMITS.text),
            press: clip(o.press != null ? o.press : a.press, LIMITS.text), wait: cleanWait(o.wait),
        };
    }

    function cleanWait(w) {
        var n = Math.round(Number(w));
        return n > 0 && isFinite(n) ? Math.min(n, LIMITS.wait) : 0;
    }

    // index: platsen i listan, annars sist. Ett eget steg ärver blocket av steget före.
    function addStep(flow, actionId, o, index) {
        if (flow.steps.length >= LIMITS.steps) return null;
        var at = index == null || index > flow.steps.length ? flow.steps.length : Math.max(0, index);
        var before = flow.steps[at - 1];
        var step = makeStep(flow, actionId, Object.assign({ block: before ? before.block : 'Egna steg' }, o));
        flow.steps.splice(at, 0, step);
        return step;
    }

    // Ändrar ett steg. Bara fälten som finns i o ändras, och de städas som när steget skapades.
    function updateStep(flow, id, o) {
        var s = flow.steps.filter(function (x) { return x.id === id; })[0];
        if (!s) return false;
        if (o.device === ALL || hasDevice(flow, o.device)) s.device = o.device;
        if (o.other != null) s.other = hasDevice(flow, o.other) ? o.other : '';
        if (o.app != null) s.app = clip(o.app, LIMITS.name).trim();
        ['do', 'done', 'press'].forEach(function (k) { if (o[k] != null) s[k] = clip(o[k], LIMITS.text); });
        if (o.wait != null) s.wait = cleanWait(o.wait);
        return true;
    }

    function removeStep(flow, id) { flow.steps = flow.steps.filter(function (s) { return s.id !== id; }); }

    function moveStep(flow, id, dir) {
        var i = flow.steps.findIndex(function (s) { return s.id === id; });
        var j = i + (dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= flow.steps.length) return false;
        var s = flow.steps[i];
        flow.steps[i] = flow.steps[j];
        flow.steps[j] = s;
        return true;
    }

    // Ett helt flöde ur standardflödena. spec: { name, prefix, devices: [namn], pair: [0, 1], apps: [namn],
    // blocks: [id] }. pair är platserna i devices för de två enheter som chattar med varandra.
    function buildFlow(spec) {
        spec = spec || {};
        var flow = emptyFlow(spec.name, spec.prefix, spec.devices);
        var ids = flow.devices.map(function (d) { return d.id; });
        var pair = spec.pair || [0, 1];
        var a = ids[pair[0]], b = ids[pair[1]];
        var canChat = !!a && !!b && a !== b;
        var apps = cleanApps(spec.apps);
        var on = {};
        (spec.blocks || []).forEach(function (id) { on[id] = true; });
        function run(block, app) {
            var title = app ? app + ': ' + block.label.charAt(0).toLowerCase() + block.label.slice(1) : block.label;
            block.make({
                a: a, b: b, devices: ids, app: app || apps[0] || 'Inställningar',
                add: function (action, device, other, o) {
                    if (flow.steps.length >= LIMITS.steps) return;
                    flow.steps.push(makeStep(flow, action, Object.assign({ block: title, device: device, other: other, app: ACTION[action].chat ? app : undefined }, o)));
                },
            });
        }
        // Chattarna görs app för app, på den plats i ordningen där de står i BLOCKS: efter klockorna i början.
        var chat = BLOCKS.filter(function (x) { return x.kind === 'chat' && on[x.id]; });
        var chatAt = BLOCKS.findIndex(function (x) { return x.kind === 'chat'; });
        BLOCKS.forEach(function (block, n) {
            if (n === chatAt && canChat) apps.forEach(function (app) { chat.forEach(function (x) { run(x, app); }); });
            if (block.kind !== 'chat' && on[block.id] && ids.length) run(block, '');
        });
        return flow;
    }

    function cleanApps(apps) {
        var seen = {}, out = [];
        (apps || []).forEach(function (x) {
            var name = clip(x, LIMITS.name).trim();
            if (name && !seen[name.toLowerCase()] && out.length < 20) { seen[name.toLowerCase()] = true; out.push(name); }
        });
        return out;
    }

    function deviceName(flow, id) {
        if (id === ALL) return 'Alla enheter';
        var d = flow.devices.filter(function (x) { return x.id === id; })[0];
        return d ? d.name : '';
    }

    // Texten i bitar: [{ text, code }]. code är sann för en kod, som ritas markerad.
    function pieces(template, ctx) {
        var out = [], last = 0, m, re = /\{(kod|förra|app|enhet|andra)\}/g, s = String(template || '');
        while ((m = re.exec(s))) {
            if (m.index > last) out.push({ text: s.slice(last, m.index), code: false });
            out.push({ text: ctx[m[1]], code: m[1] === 'kod' || m[1] === 'förra' });
            last = m.index + m[0].length;
        }
        if (last < s.length) out.push({ text: s.slice(last), code: false });
        return out;
    }
    function plain(parts) { return parts.map(function (p) { return p.text; }).join(''); }

    // Flödet som det visas: varje steg med sin kod och sina färdiga texter.
    function view(flow) {
        var width = flow.steps.length >= 100 ? 3 : 2;
        var prev = '';
        return flow.steps.map(function (s, n) {
            var code = flow.prefix + pad(n + 1, width);
            var ctx = { kod: code, 'förra': prev || code, app: s.app || 'appen', enhet: deviceName(flow, s.device) || 'enheten', andra: deviceName(flow, s.other) || 'den andra enheten' };
            var doParts = pieces(s.do, ctx);
            var done = plain(pieces(s.done, ctx)).trim();
            prev = code;
            return {
                id: s.id, n: n, code: code, block: s.block, device: s.device, deviceName: deviceName(flow, s.device), app: s.app, parts: doParts, do: plain(doParts).trim(),
                done: done || plain(doParts).trim(), press: s.press || 'när det är gjort', wait: s.wait || 0,
            };
        });
    }

    // Ungefärlig tid: 40 sekunder per steg plus väntan.
    function estimate(flow) {
        var wait = flow.steps.reduce(function (sum, s) { return sum + (s.wait || 0); }, 0);
        return { steps: flow.steps.length, waitS: wait, totalS: flow.steps.length * 40 + wait };
    }

    // Stegen som en lista att skriva ut, med samma koder och en tom ruta för klockslaget. Den går att fylla i för
    // hand om datorn inte kan stå framme.
    function checklist(flow) {
        var FONT = 'font-family: Arial, Helvetica, sans-serif;';
        var TD = 'border: 1px solid #999; padding: 4px 6px; vertical-align: top; font-size: 10pt; ' + FONT;
        var TH = TD + ' background: #e8e8e8; text-align: left; font-weight: bold;';
        var e = estimate(flow), block = null;
        var html = '<h2 style="' + FONT + ' margin: 0 0 4px;">' + softHtml(flow.name) + '</h2>';
        html += '<p style="' + FONT + ' font-size: 10pt; margin: 0 0 8px;">' + e.steps + ' steg, ungefär ' + Math.ceil(e.totalS / 60) + ' minuter varav ' + Math.round(e.waitS / 60) +
            ' minuter väntan. Skriv klockslaget i rutan när steget är gjort.</p>';
        html += '<table style="border-collapse: collapse; width: 100%;"><tr>' + ['Kod', 'Enhet', 'App', 'Gör så här', 'Klockslag'].map(function (h) {
            return '<th style="' + TH + '">' + h + '</th>';
        }).join('') + '</tr>';
        view(flow).forEach(function (s) {
            if (s.block !== block) {
                block = s.block;
                html += '<tr><td colspan="5" style="' + TD + ' font-weight: bold; background: #f4f4f4;">' + softHtml(block) + '</td></tr>';
            }
            var text = softHtml(s.do) + ' <span style="color: #555;">Klart ' + softHtml(s.press) + '.</span>' + (s.wait ? ' <b>Vänta sedan ' + spanText(s.wait) + '.</b>' : '');
            html += '<tr><td style="' + TD + ' white-space: nowrap; font-weight: bold;">' + esc(s.code) + '</td><td style="' + TD + '">' + softHtml(s.deviceName) + '</td><td style="' + TD + '">' + softHtml(s.app) +
                '</td><td style="' + TD + '">' + text + '</td><td style="' + TD + ' width: 22mm;"></td></tr>';
        });
        return html + '</table>';
    }

    // ---------- Tiden ----------

    // clock: { t: millisekunder, off: datorns minuter öster om UTC i det ögonblicket }.
    function clockNow(date) {
        var d = date || new Date();
        return { t: d.getTime(), off: -d.getTimezoneOffset() };
    }
    function offsetText(off) {
        var a = Math.abs(off);
        return (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
    }
    // 2026-11-11T14:03:27.412+01:00
    function isoLocal(t, off) { return new Date(t + off * 60000).toISOString().slice(0, 23) + offsetText(off); }
    function timeText(t, off) { return isoLocal(t, off).slice(11, 19); }
    function dateText(t, off) { return isoLocal(t, off).slice(0, 10); }
    function spanText(seconds) {
        var s = Math.max(0, Math.round(seconds));
        return Math.floor(s / 60) + ':' + pad(s % 60);
    }

    // ---------- Körningen ----------

    // entries har en rad per steg i flödets ordning: nästa steg är alltid entries.length.
    function newRun(clock, zone) {
        return { started: clock.t, off: clock.off, zone: clip(zone, LIMITS.name), entries: [], notes: [], undone: [], waitUntil: 0, waitStep: '' };
    }
    function isDone(flow, run) { return run.entries.length >= flow.steps.length; }
    function isWaiting(run, t) { return run.waitUntil > t; }

    // status: 'klar' eller 'hoppad'. Under en väntan tas inget tryck emot.
    function press(flow, run, clock, status) {
        if (isDone(flow, run) || isWaiting(run, clock.t)) return false;
        var s = flow.steps[run.entries.length];
        var e = { step: s.id, status: status === 'hoppad' ? 'hoppad' : 'klar', t: clock.t, off: clock.off };
        run.waitUntil = e.status === 'klar' && s.wait > 0 ? clock.t + s.wait * 1000 : 0;
        run.waitStep = run.waitUntil ? s.id : '';
        if (run.waitUntil) e.wait = s.wait;
        run.entries.push(e);
        return true;
    }

    // Det senaste trycket tas tillbaka. Det står kvar i loggen bland de ångrade.
    function undo(run, clock) {
        if (!run.entries.length) return false;
        var e = run.entries.pop();
        run.undone.push(Object.assign({}, e, { undoneAt: clock.t }));
        run.waitUntil = 0;
        run.waitStep = '';
        return true;
    }

    // Trycket kom senare än åtgärden: tiden på det senaste gjorda steget märks som ungefärlig. Ett tryck till tar bort märket.
    function toggleApprox(run) {
        var e = run.entries[run.entries.length - 1];
        if (!e || e.status !== 'klar') return null;
        e.approx = !e.approx;
        return e.approx;
    }

    // En anteckning, eller något som gjordes utöver flödet när device är en enhet.
    function addNote(flow, run, clock, text, device) {
        var t = clip(text, LIMITS.text).trim();
        if (!t || run.notes.length >= LIMITS.notes) return false;
        run.notes.push({ t: clock.t, off: clock.off, text: t, device: hasDevice(flow, device) ? device : '' });
        return true;
    }

    function cutWait(run, clock) {
        if (!isWaiting(run, clock.t)) return false;
        var e = run.entries[run.entries.length - 1];
        if (e && e.step === run.waitStep) e.waited = Math.round((clock.t - e.t) / 1000);
        run.waitUntil = 0;
        run.waitStep = '';
        return true;
    }

    // Undersökarens egen anmärkning på en rad, skriven efteråt. Tiderna går inte att ändra.
    function setRemark(run, stepId, text) {
        var e = run.entries.filter(function (x) { return x.step === stepId; })[0];
        if (!e) return false;
        e.remark = clip(text, LIMITS.text).trim();
        return true;
    }

    // ---------- Tabellen ----------

    // Raderna i tidsordning: gjorda steg, anteckningar och det som inte gjordes. Steg som aldrig nåddes står sist.
    function rows(flow, run) {
        var steps = view(flow), byId = {}, out = [];
        steps.forEach(function (s) { byId[s.id] = s; });
        run.entries.forEach(function (e, n) {
            var s = byId[e.step];
            if (!s) return;
            var remarks = [];
            if (e.status === 'hoppad') remarks.push('Hoppades över ' + timeText(e.t, e.off) + '.');
            if (e.approx) remarks.push('Tiden är ungefärlig: knappen trycktes senare än åtgärden gjordes.');
            if (e.wait) remarks.push(e.waited != null ? 'Väntan därefter avbröts efter ' + spanText(e.waited) + ' av ' + spanText(e.wait) + '.' : 'Därefter väntan ' + spanText(e.wait) + '.');
            if (e.remark) remarks.push(e.remark);
            out.push({ kind: e.status === 'klar' ? 'step' : 'skipped', step: s.id, t: e.t, off: e.off, order: n * 2, device: s.deviceName, app: s.app,
                action: e.status === 'klar' ? s.done : s.do, code: s.code, approx: !!e.approx, remark: remarks.join(' ') });
        });
        run.notes.forEach(function (x, n) {
            var d = deviceName(flow, x.device);
            out.push({ kind: 'note', step: '', t: x.t, off: x.off, order: 1e6 + n, device: d, app: '', action: (d ? 'Utöver flödet: ' : 'Anteckning: ') + x.text, code: '', approx: false, remark: '' });
        });
        out.sort(function (p, q) { return p.t - q.t || p.order - q.order; });
        steps.slice(run.entries.length).forEach(function (s) {
            out.push({ kind: 'left', step: s.id, t: null, off: null, device: s.deviceName, app: s.app, action: s.do, code: s.code, approx: false, remark: 'Laborationen avslutades före steget.' });
        });
        var days = {};
        out.forEach(function (r) { if (r.t != null) days[dateText(r.t, r.off)] = true; });
        var many = Object.keys(days).length > 1;
        out.forEach(function (r) {
            r.done = r.kind === 'step' || r.kind === 'note';
            r.time = !r.done ? 'inte utförd' : (many ? dateText(r.t, r.off) + ' ' : '') + (r.approx ? 'ca ' : '') + timeText(r.t, r.off);
        });
        return out;
    }

    // Uppgifterna ovanför tabellen, som par av rubrik och text.
    function facts(flow, run, program) {
        var list = rows(flow, run);
        var timed = list.filter(function (r) { return r.t != null; });
        var last = timed.length ? timed[timed.length - 1] : { t: run.started, off: run.off };
        var offs = {};
        offs[offsetText(run.off)] = true;
        timed.forEach(function (r) { offs[offsetText(r.off)] = true; });
        var count = function (kind) { return list.filter(function (r) { return r.kind === kind; }).length; };
        var notDone = count('skipped') + count('left');
        var d1 = dateText(run.started, run.off), d2 = dateText(last.t, last.off);
        var out = [
            ['Laboration', flow.name],
            ['Datum', d1 === d2 ? d1 : d1 + ' till ' + d2],
            ['Tid', timeText(run.started, run.off) + ' till ' + timeText(last.t, last.off)],
            ['Klocka', 'Datorns klocka' + (run.zone ? ', tidszon ' + run.zone : '') + ' (UTC' + Object.keys(offs).join(' och UTC') + '). Tiden på en rad är när undersökaren tryckte att steget var gjort.'],
            ['Enheter', flow.devices.map(function (d) { return d.name; }).join(', ')],
            ['Steg', count('step') + ' utförda' + (notDone ? ', ' + notDone + ' inte utförda' : '') + (count('note') ? ', ' + count('note') + (count('note') === 1 ? ' anteckning' : ' anteckningar') : '')],
            ['Kod', 'Koden skrevs i meddelandet eller syns i bilden av datorns skärm, så att spåret i enheten kan knytas till raden.'],
        ];
        if (run.undone.length) out.push(['Ångrat', run.undone.length + ' tryck ångrades under laborationen. De står i loggfilen.']);
        if (program) out.push(['Program', program]);
        return out;
    }

    var HEAD = ['Tid', 'Enhet', 'Åtgärd', 'Kod', 'Anmärkning'];
    function cells(r) { return [r.time, r.device, r.action, r.code, r.remark]; }

    // Tabellen till protokollet som HTML med inline-stilar, så att Word gör en tabell av den vid inklistring,
    // och som text med tabbar. Allt som kommer ur flödet eller loggen skrivs som text, aldrig som HTML.
    function protocol(flow, run, program) {
        var FONT = 'font-family: Arial, Helvetica, sans-serif;';
        var TD = 'border: 1px solid #999; padding: 3px 6px; vertical-align: top; font-size: 10pt; ' + FONT;
        var TH = TD + ' background: #e8e8e8; text-align: left; font-weight: bold;';
        var TABLE = 'border-collapse: collapse; margin: 6px 0 12px;';
        var f = facts(flow, run, program), list = rows(flow, run);
        var html = '<h2 style="' + FONT + ' margin: 14px 0 6px;">Laboration: ' + softHtml(flow.name) + '</h2>';
        html += '<table style="' + TABLE + '">' + f.slice(1).map(function (x) {
            return '<tr><td style="' + TD + '"><b>' + esc(x[0]) + '</b></td><td style="' + TD + '">' + softHtml(x[1]) + '</td></tr>';
        }).join('') + '</table>';
        html += '<table style="' + TABLE + '"><tr>' + HEAD.map(function (h) { return '<th style="' + TH + '">' + esc(h) + '</th>'; }).join('') + '</tr>';
        list.forEach(function (r) {
            var style = TD + (r.done ? '' : ' color: #666;');
            html += '<tr>' + cells(r).map(function (c, n) { return '<td style="' + style + (n === 0 || n === 3 || (n === 1 && c.length <= 22) ? ' white-space: nowrap;' : '') + '">' + softHtml(c) + '</td>'; }).join('') + '</tr>';
        });
        html += '</table>';
        var oneLine = function (c) { return String(c).replace(/[\t\r\n]+/g, ' '); };
        var text = f.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') + '\n\n' + HEAD.join('\t') + '\n' +
            list.map(function (r) { return cells(r).map(oneLine).join('\t'); }).join('\n') + '\n';
        return { html: html, text: text };
    }

    // En cell som börjar som en formel får en apostrof först, så att ett kalkylprogram inte räknar den.
    function csvField(value) {
        var text = value == null ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return /[";\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function toCsv(flow, run) {
        var lines = ['Datum;Tid;UTC;Enhet;App;Åtgärd;Kod;Status;Anmärkning'];
        var status = { step: 'utförd', note: 'anteckning', skipped: 'inte utförd', left: 'inte utförd' };
        rows(flow, run).forEach(function (r) {
            var timed = r.done;
            lines.push([timed ? dateText(r.t, r.off) : '', timed ? timeText(r.t, r.off) : '', timed ? new Date(r.t).toISOString() : '', r.device, r.app, r.action, r.code,
                status[r.kind] + (r.approx ? ', tiden ungefärlig' : ''), r.remark].map(csvField).join(';'));
        });
        return lines.join('\r\n') + '\r\n';
    }

    // ---------- Filen ----------

    // Flödet, och loggen om laborationen har börjat. rader är tabellen i klartext, för den som läser filen utan programmet.
    function toFile(flow, run, program, clock) {
        var out = { format: FORMAT, version: 1, sparad: isoLocal(clock.t, clock.off), program: program || '', flow: flow, run: run || null };
        if (run) {
            out.rader = rows(flow, run).map(function (r) {
                return { tid: r.done ? isoLocal(r.t, r.off) : null, utc: r.done ? new Date(r.t).toISOString() : null, ungefarlig: r.approx, enhet: r.device, app: r.app, atgard: r.action, kod: r.code,
                    status: r.kind === 'step' ? 'utförd' : r.kind === 'note' ? 'anteckning' : 'inte utförd', anmarkning: r.remark };
            });
        }
        return out;
    }

    function fileName(flow, run, ext) {
        var base = flow.name.replace(/[^A-Za-z0-9ÅÄÖåäö]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'laboration';
        return (run ? 'laboration-' + dateText(run.started, run.off) + '-' : 'flode-') + base + '.' + ext;
    }

    function num(v, min, max) { return typeof v === 'number' && isFinite(v) && v >= min && v <= max; }

    // En fil från någon annan är indata som alla andra: allt byggs om fält för fält, och det som inte stämmer avvisas.
    function fromFile(text) {
        var o;
        try { o = JSON.parse(text); } catch (e) { throw new Error('Filen är inte JSON.'); }
        if (!o || o.format !== FORMAT || !o.flow) throw new Error('Filen är inte ett flöde eller en logg från Laboration.');
        if (o.version !== 1) throw new Error('Filen är skriven av en nyare version av programmet.');
        var f = o.flow;
        if (!Array.isArray(f.devices) || !Array.isArray(f.steps)) throw new Error('Flödet i filen saknar enheter eller steg.');
        if (f.devices.length > LIMITS.devices || f.steps.length > LIMITS.steps) throw new Error('Flödet i filen har för många enheter eller steg.');
        var flow = { name: clip(f.name, LIMITS.name).trim() || 'Laboration', prefix: cleanPrefix(f.prefix), devices: [], steps: [], next: 1 };
        var ids = {};
        var okId = function (id) { return typeof id === 'string' && /^[a-z]\d{1,6}$/.test(id) && !ids[id]; };
        f.devices.forEach(function (d) {
            if (!d || !okId(d.id)) throw new Error('En enhet i filen saknar ett giltigt id.');
            ids[d.id] = 'device';
            flow.devices.push({ id: d.id, name: clip(d.name, LIMITS.name).trim() || 'Enhet ' + (flow.devices.length + 1) });
        });
        f.steps.forEach(function (s) {
            if (!s || !okId(s.id)) throw new Error('Ett steg i filen saknar ett giltigt id.');
            if (s.device !== ALL && ids[s.device] !== 'device') throw new Error('Ett steg i filen pekar på en enhet som inte finns.');
            ids[s.id] = 'step';
            flow.steps.push({
                id: s.id, action: ACTION[s.action] ? s.action : 'custom', block: clip(s.block, LIMITS.name), device: s.device, other: ids[s.other] === 'device' ? s.other : '',
                app: clip(s.app, LIMITS.name).trim(), do: clip(s.do, LIMITS.text), done: clip(s.done, LIMITS.text), press: clip(s.press, LIMITS.text), wait: cleanWait(s.wait),
            });
        });
        Object.keys(ids).forEach(function (id) { flow.next = Math.max(flow.next, Number(id.slice(1)) + 1); });

        var r = o.run, run = null;
        if (r) {
            var T = 4e12;
            if (!num(r.started, 0, T) || !num(r.off, -900, 900) || !Array.isArray(r.entries) || r.entries.length > flow.steps.length) throw new Error('Loggen i filen går inte att läsa.');
            run = { started: r.started, off: r.off, zone: clip(r.zone, LIMITS.name), entries: [], notes: [], undone: [], waitUntil: num(r.waitUntil, 0, T) ? r.waitUntil : 0, waitStep: '' };
            var entry = function (e) {
                if (!e || !num(e.t, 0, T) || !num(e.off, -900, 900)) throw new Error('En rad i loggen saknar en giltig tid.');
                var out = { step: String(e.step), status: e.status === 'hoppad' ? 'hoppad' : 'klar', t: e.t, off: e.off };
                if (e.approx === true) out.approx = true;
                if (num(e.wait, 1, LIMITS.wait)) out.wait = e.wait;
                if (num(e.waited, 0, LIMITS.wait)) out.waited = e.waited;
                if (e.remark) out.remark = clip(e.remark, LIMITS.text).trim();
                return out;
            };
            r.entries.forEach(function (e, n) {
                var x = entry(e);
                if (x.step !== flow.steps[n].id) throw new Error('Loggen i filen hör inte till flödet i samma fil.');
                run.entries.push(x);
            });
            (Array.isArray(r.notes) ? r.notes : []).slice(0, LIMITS.notes).forEach(function (x) {
                if (!x || !num(x.t, 0, T) || !num(x.off, -900, 900)) throw new Error('En anteckning i loggen saknar en giltig tid.');
                var t = clip(x.text, LIMITS.text).trim();
                if (t) run.notes.push({ t: x.t, off: x.off, text: t, device: ids[x.device] === 'device' ? x.device : '' });
            });
            (Array.isArray(r.undone) ? r.undone : []).slice(0, LIMITS.notes).forEach(function (e) {
                var x = entry(e);
                if (ids[x.step] === 'step') run.undone.push(Object.assign(x, { undoneAt: num(e.undoneAt, 0, T) ? e.undoneAt : x.t }));
            });
            var lastEntry = run.entries[run.entries.length - 1];
            run.waitStep = run.waitUntil && lastEntry ? lastEntry.step : '';
            if (!run.waitStep) run.waitUntil = 0;
        }
        return { flow: flow, run: run };
    }

    var api = {
        FORMAT: FORMAT, ALL: ALL, APPS: APPS, ACTIONS: ACTIONS, ACTION: ACTION, BLOCKS: BLOCKS, LIMITS: LIMITS, HEAD: HEAD,
        emptyFlow: emptyFlow, addDevice: addDevice, removeDevice: removeDevice, addStep: addStep, updateStep: updateStep, removeStep: removeStep, moveStep: moveStep, buildFlow: buildFlow, cleanApps: cleanApps,
        cleanPrefix: cleanPrefix, cleanWait: cleanWait, clip: clip, esc: esc, softParts: softParts, deviceName: deviceName, view: view, estimate: estimate, checklist: checklist,
        clockNow: clockNow, offsetText: offsetText, isoLocal: isoLocal, timeText: timeText, dateText: dateText, spanText: spanText,
        newRun: newRun, isDone: isDone, isWaiting: isWaiting, press: press, undo: undo, toggleApprox: toggleApprox, addNote: addNote, cutWait: cutWait, setRemark: setRemark,
        rows: rows, cells: cells, facts: facts, protocol: protocol, toCsv: toCsv, toFile: toFile, fileName: fileName, fromFile: fromFile,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LabCore = api;
})(typeof window !== 'undefined' ? window : this);
