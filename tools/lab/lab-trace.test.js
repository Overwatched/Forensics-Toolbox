const test = require('node:test');
const assert = require('node:assert');
const L = require('./lab-core.js');
const T = require('./lab-trace.js');

// 2026-11-12 13:00:00 svensk vintertid. Steg n trycks en minut efter det förra: L01 13:01:00, L02 13:02:00 …
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const at = (step, seconds) => T0 + step * 60000 + (seconds || 0) * 1000;

// Ett flöde av påhittade steg mellan två enheter, och en logg där alla utom de sista är gjorda.
function lab(list, opts) {
    opts = opts || {};
    const flow = L.emptyFlow('Prov', 'L', ['Samsung', 'iPhone']);
    const [a, b] = flow.devices.map((d) => d.id);
    list.forEach((x) => {
        const dev = x[1] === 'B' ? b : x[1] === '*' ? L.ALL : a;
        L.addStep(flow, x[0], { device: dev, other: L.ACTION[x[0]].chat ? (dev === a ? b : a) : '', app: x[2] || '' });
    });
    const run = L.newRun({ t: T0, off: 60 }, 'Europe/Stockholm');
    L.view(flow).forEach((s, n) => {
        if (n >= list.length - (opts.left || 0)) return;
        run.entries.push({ step: s.id, status: (opts.skipped || []).indexOf(s.code) >= 0 ? 'hoppad' : 'klar', t: at(n + 1), off: 60 });
    });
    return { flow, run, a, b };
}

const times = (o) => Object.keys(o).map((key) => ({ key, label: 'Tiden ' + key, col: 'message.' + key, ms: o[key] }));
let serial = 0;
const msg = (o) => Object.assign({ key: 'm' + ++serial, app: 'WhatsApp', base: 'msgstore.db', fromMe: false, kind: 'text', deleted: false, codes: [], sortMs: o.times[0].ms }, o);
const empty = () => ({ messages: [], threads: [], media: [], events: [], locks: [], apps: [] });
const row = (res, code) => res.rows.filter((r) => r.code === code)[0];
const on = (r, device) => r.traces.filter((t) => t.device === device);

test('koderna i en text hittas utan att ett längre ord eller tal räknas', () => {
    assert.deepStrictEqual(T.codesIn('L03', 'L'), ['L03']);
    assert.deepStrictEqual(T.codesIn('Hej l03, och L04 raderas. L03 igen', 'L'), ['L03', 'L04']);
    assert.deepStrictEqual(T.codesIn('XL05 L061 BILL07 L7 5L08', 'L'), []);
    // Ett ord skrivet direkt efter koden hindrar inte, men koden ska stå först.
    assert.deepStrictEqual(T.codesIn('L03raderas L04L05', 'L'), ['L03', 'L04']);
    assert.deepStrictEqual(T.codesIn('(L08) "L09" L10.', 'L'), ['L08', 'L09', 'L10']);
    assert.deepStrictEqual(T.codesIn('AB012 AB12 ab013', 'AB', 3), ['AB012', 'AB013']);
    assert.deepStrictEqual(T.codesIn(null, 'L'), []);
});

test('en app känns igen på sitt id i telefonens logg, och en okänd app på namnet i id:t', () => {
    assert.ok(T.appIs('com.whatsapp', 'WhatsApp'));
    assert.ok(T.appIs('net.whatsapp.WhatsApp', 'whatsapp'));
    assert.ok(!T.appIs('com.whatsapp.w4b', 'Signal'));
    assert.ok(T.appIs('org.thoughtcrime.securesms', 'Signal'));
    assert.ok(T.appIs('com.apple.Preferences', 'Inställningar'));
    assert.ok(T.appIs('com.wickr.pro', 'Wickr'));
    assert.ok(!T.appIs('com.example.app', 'Wickr'));
    assert.ok(!T.appIs('com.example.app', ''));
    assert.ok(!T.appIs('com.example.abc', 'ab'));
});

test('ett meddelande med koden är ett säkert spår på båda enheterna, med rätt tid för var och en', () => {
    const { flow, run, a, b } = lab([['text', 'A', 'WhatsApp'], ['reply', 'B', 'WhatsApp']]);
    const ev = { [a]: empty(), [b]: empty() };
    ev[a].messages.push(msg({ fromMe: true, codes: ['L01'], times: times({ written: at(1, -4), read: at(1, 30) }) }));
    ev[b].messages.push(msg({ base: 'ChatStorage.sqlite', codes: ['L01'], times: times({ sent: at(1, -5), received: at(1, -3) }), sortMs: at(1, -5) }));
    ev[b].messages.push(msg({ base: 'ChatStorage.sqlite', fromMe: true, codes: ['L02'], times: times({ date: at(2, -10) }) }));
    ev[a].messages.push(msg({ codes: ['L02'], times: times({ written: at(2, -11), arrived: at(2, -9) }) }));
    const res = T.match(flow, run, ev);
    const r1 = row(res, 'L01'), r2 = row(res, 'L02');
    assert.strictEqual(r1.mark, 'sure');
    assert.deepStrictEqual(r1.traces.map((t) => [t.deviceName, t.what, t.ms, t.mark]), [['Samsung', 'skickat', at(1, -4), 'sure'], ['iPhone', 'mottaget', at(1, -3), 'sure']]);
    assert.strictEqual(r1.traces[0].source, 'msgstore.db · message.written');
    assert.strictEqual(r1.traces[1].source, 'ChatStorage.sqlite · message.received');
    assert.strictEqual(r1.pressedAfter, 4000);
    // Stegets egen enhet står först, också när den är den andra i flödet.
    assert.deepStrictEqual(r2.traces.map((t) => [t.deviceName, t.what, t.ms]), [['iPhone', 'skickat', at(2, -10)], ['Samsung', 'mottaget', at(2, -9)]]);
    assert.deepStrictEqual(res.summary, { sure: 2, chosen: 0, likely: 0, many: 0, none: 0, wait: 0, off: 0 });
    assert.deepStrictEqual(res.delay, { ms: 7000, n: 2 });
});

test('ett säkert spår gäller också när loggens tid ligger långt ifrån, och utan extraktion väntar steget', () => {
    const { flow, run, a, b } = lab([['text', 'A', 'WhatsApp'], ['photo', 'B']]);
    const ev = { [a]: empty() };
    ev[a].messages.push(msg({ fromMe: true, codes: ['L01'], times: times({ written: at(1, -1500) }) }));
    const res = T.match(flow, run, ev);
    assert.strictEqual(row(res, 'L01').mark, 'sure');
    assert.strictEqual(row(res, 'L01').pressedAfter, 1500000);
    assert.strictEqual(row(res, 'L02').mark, 'wait');
    assert.deepStrictEqual(res.devices.map((d) => d.read), [true, false]);
    // Den andra enhetens spår söks först när dess extraktion är vald.
    assert.deepStrictEqual(row(res, 'L01').traces.map((t) => t.device), [a]);
    ev[b] = empty();
    const more = T.match(flow, run, ev);
    assert.deepStrictEqual(on(row(more, 'L01'), b).map((t) => t.mark), ['none']);
    assert.strictEqual(row(more, 'L02').mark, 'none');
});

test('läst hittas i meddelandet före: säkert när tiden heter läst, annars troligt på en annan tid eller på appen', () => {
    const { flow, run, a, b } = lab([['text', 'A', 'WhatsApp'], ['read', 'B', 'WhatsApp'], ['text', 'A', 'Signal'], ['read', 'B', 'Signal']]);
    const ev = { [a]: empty(), [b]: empty() };
    ev[a].messages.push(msg({ fromMe: true, codes: ['L01'], times: times({ written: at(1, -4), delivered: at(1, -2), read: at(2, -6) }) }));
    ev[b].messages.push(msg({ codes: ['L01'], times: times({ date: at(1, -3), sent: at(2, -6) }) }));
    ev[a].messages.push(msg({ app: 'Signal', fromMe: true, codes: ['L03'], times: times({ sent: at(3, -4) }) }));
    ev[b].apps.push({ key: 'u1', base: 'knowledgeC.db', col: '/app/usage', app: 'org.whispersystems.signal', startMs: at(4, -8), endMs: at(4, 40) });
    ev[b].apps.push({ key: 'u2', base: 'knowledgeC.db', col: '/app/usage', app: 'net.whatsapp.WhatsApp', startMs: at(4, -30), endMs: at(4, -9) });
    const res = T.match(flow, run, ev);
    const r2 = row(res, 'L02'), r4 = row(res, 'L04');
    // På läsarens enhet finns ingen tid som heter läst, men en annan tid i meddelandet ligger nära loggens.
    assert.deepStrictEqual(r2.traces.map((t) => [t.deviceName, t.what, t.ms, t.mark]), [['iPhone', 'en senare tid i meddelandet (Tiden sent)', at(2, -6), 'likely'], ['Samsung', 'läst', at(2, -6), 'sure']]);
    assert.strictEqual(r2.mark, 'sure');
    // Meddelandet är kvar som spår för steget som skickade det.
    assert.strictEqual(row(res, 'L01').mark, 'sure');
    // Utan meddelandet på läsarens enhet: när appen kom fram.
    assert.deepStrictEqual(on(r4, b).map((t) => [t.what, t.ms, t.endMs, t.mark, t.source]), [['appen framme', at(4, -8), at(4, 40), 'likely', 'knowledgeC.db · /app/usage']]);
    assert.strictEqual(r4.mark, 'likely');
    assert.strictEqual(r4.pressedAfter, null);
});

test('ett raderat meddelande hittas på koden när texten finns kvar, annars som raderad rad nära loggens tid', () => {
    const { flow, run, a, b } = lab([['text-delete', 'A', 'WhatsApp'], ['delete', 'A', 'WhatsApp'], ['text-delete', 'A', 'Signal'], ['delete', 'A', 'Signal']]);
    const ev = { [a]: empty(), [b]: empty() };
    // WhatsApp: texten är borta på båda enheterna. Avsändaren har en tid för raderingen, mottagaren inte.
    ev[a].messages.push(msg({ fromMe: true, kind: 'deleted', deleted: true, times: times({ written: at(1, -5), revoked: at(2, -3) }) }));
    ev[b].messages.push(msg({ kind: 'deleted', deleted: true, times: times({ date: at(1, -4) }) }));
    // Signal: texten finns kvar på avsändarens enhet, och raden är märkt som raderad.
    ev[a].messages.push(msg({ app: 'Signal', base: 'signal.db', fromMe: true, deleted: true, codes: ['L03'], times: times({ sent: at(3, -5) }) }));
    const res = T.match(flow, run, ev);
    assert.deepStrictEqual(row(res, 'L01').traces.map((t) => [t.deviceName, t.what, t.ms, t.mark]),
        [['Samsung', 'skickat, texten finns inte kvar', at(1, -5), 'likely'], ['iPhone', 'mottaget, texten finns inte kvar', at(1, -4), 'likely']]);
    assert.deepStrictEqual(row(res, 'L02').traces.map((t) => [t.deviceName, t.what, t.ms, t.mark]),
        [['Samsung', 'raderat', at(2, -3), 'likely'], ['iPhone', 'raden är raderad; tiden är när den kom', at(1, -4), 'likely']]);
    assert.strictEqual(row(res, 'L02').pressedAfter, 3000);
    assert.strictEqual(row(res, 'L03').mark, 'sure');
    const r4 = row(res, 'L04');
    assert.deepStrictEqual(on(r4, a).map((t) => [t.what, t.mark, t.notWhen]), [['raden är raderad; tiden är när den skrevs', 'sure', true]]);
    // En tid som inte är raderingens säger inget om hur sent det trycktes.
    assert.strictEqual(r4.pressedAfter, null);
    assert.deepStrictEqual(on(r4, b).map((t) => t.mark), ['none']);
});

test('en grupp hittas på koden i namnet, och röstmeddelanden och samtal på sorten nära loggens tid', () => {
    const { flow, run, a, b } = lab([['group', 'A', 'WhatsApp'], ['voice', 'A', 'WhatsApp'], ['call', 'B', 'WhatsApp'], ['call', 'B', 'Signal']]);
    const ev = { [a]: empty(), [b]: empty() };
    ev[a].threads.push({ key: 't1', app: 'WhatsApp', base: 'msgstore.db', col: 'message.timestamp', codes: ['L01'], firstMs: at(1, -7) });
    ev[b].threads.push({ key: 't2', app: 'WhatsApp', base: 'ChatStorage.sqlite', col: 'ZMESSAGEDATE', codes: ['L01'], firstMs: at(1, -6) });
    ev[a].messages.push(msg({ fromMe: true, kind: 'voice', times: times({ written: at(2, -5) }) }));
    ev[b].messages.push(msg({ kind: 'voice', times: times({ date: at(2, -4) }) }));
    // Ett röstmeddelande i en annan app räknas inte.
    ev[b].messages.push(msg({ app: 'Telegram', kind: 'voice', times: times({ date: at(2, -3) }) }));
    ev[b].messages.push(msg({ fromMe: true, kind: 'call', times: times({ date: at(3, -15) }) }));
    ev[a].messages.push(msg({ kind: 'call', times: times({ written: at(3, -14) }) }));
    const res = T.match(flow, run, ev);
    assert.deepStrictEqual(row(res, 'L01').traces.map((t) => [t.deviceName, t.what, t.ms, t.mark, t.source]),
        [['Samsung', 'gruppens första rad', at(1, -7), 'sure', 'msgstore.db · message.timestamp'], ['iPhone', 'gruppens första rad', at(1, -6), 'sure', 'ChatStorage.sqlite · ZMESSAGEDATE']]);
    assert.deepStrictEqual(row(res, 'L02').traces.map((t) => [t.deviceName, t.what, t.ms, t.mark]), [['Samsung', 'skickat', at(2, -5), 'likely'], ['iPhone', 'mottaget', at(2, -4), 'likely']]);
    assert.deepStrictEqual(row(res, 'L03').traces.map((t) => [t.deviceName, t.what, t.mark]), [['iPhone', 'samtal', 'likely'], ['Samsung', 'samtal', 'likely']]);
    assert.strictEqual(row(res, 'L04').mark, 'none');
});

test('utan kod i meddelandet eller gruppens namn: rätt sort i rätt app nära loggens tid är troligt', () => {
    const { flow, run, a, b } = lab([['photo-app', 'A', 'Snapchat'], ['photo-app', 'A', 'Snapchat'], ['text', 'B', 'Signal'], ['group', 'A', 'Signal'], ['read', 'A', 'Signal']]);
    const ev = { [a]: empty(), [b]: empty() };
    const snap = (o) => msg(Object.assign({ app: 'Snapchat', base: 'arroyo.db', kind: 'other' }, o));
    ev[a].messages.push(snap({ fromMe: true, times: times({ created: at(1, -5) }) }), snap({ fromMe: true, times: times({ created: at(2, -7) }) }));
    ev[b].messages.push(snap({ times: times({ created: at(1, -4) }) }), snap({ times: times({ created: at(2, -6) }) }));
    // En bild i en annan app, en text i rätt app och ett raderat meddelande räknas inte som bilden.
    ev[a].messages.push(msg({ fromMe: true, kind: 'image', times: times({ written: at(1, -6) }) }), snap({ fromMe: true, kind: 'text', times: times({ created: at(1, -3) }) }),
        snap({ fromMe: true, deleted: true, times: times({ created: at(1, -2) }) }));
    // En text där koden glömdes, och en grupp vars namn inte har koden.
    ev[b].messages.push(msg({ app: 'Signal', fromMe: true, times: times({ sent: at(3, -8), delivered: at(3, -7) }) }));
    ev[a].threads.push({ key: 't9', app: 'Signal', base: 'signal.db', col: 'date_received', codes: [], firstMs: at(4, -12) });
    ev[a].threads.push({ key: 't8', app: 'WhatsApp', base: 'msgstore.db', col: 'message.timestamp', codes: [], firstMs: at(4, -11) });
    const res = T.match(flow, run, ev);
    const r1 = row(res, 'L01');
    // Två bilder ryms i fönstret, och den sista före trycket föreslås. Nästa steg får den som är kvar.
    assert.deepStrictEqual(r1.traces.map((t) => [t.deviceName, t.what, t.ms, t.mark, t.options.length]),
        [['Samsung', 'skickat, utan kod i meddelandet', at(1, -5), 'many', 2], ['iPhone', 'mottaget, utan kod i meddelandet', at(1, -4), 'many', 2]]);
    assert.deepStrictEqual(row(res, 'L02').traces.map((t) => [t.ms, t.mark]), [[at(2, -7), 'likely'], [at(2, -6), 'likely']]);
    assert.deepStrictEqual(on(row(res, 'L03'), b).map((t) => [t.what, t.ms, t.mark]), [['skickat, utan kod i meddelandet', at(3, -8), 'likely']]);
    assert.deepStrictEqual(on(row(res, 'L04'), a).map((t) => [t.what, t.ms, t.mark, t.source]), [['gruppens första rad, utan kod i namnet', at(4, -12), 'likely', 'signal.db · date_received']]);
    // I ett skickat meddelande är de andra tiderna inte när det lästes.
    assert.strictEqual(row(res, 'L05').mark, 'none');
});

test('en rad som telefonen skriver först efteråt hittas fram till nästa steg på enheten och säger inte när det hände', () => {
    const { flow, run, a } = lab([['power-off', 'A'], ['power-on', 'A'], ['unlock', 'A'], ['power-on', 'A']]);
    const ev = { [a]: empty() };
    const e = (key, kind, ms, more) => Object.assign({ key, base: 'usagestats', col: 'händelse ' + kind, kind, ms }, more || {});
    const late = { late: true, what: 'startad; raden skrivs vid första upplåsningen efter starten' };
    // Starten trycktes 13:02:00, men raden om den skrevs 13:03:20 när telefonen låstes upp, utanför fönstrets minut efter.
    ev[a].events.push(e('e1', 'off', at(1, -5)), e('e2', 'on', at(3, 20), late), e('e3', 'unlock', at(3, 20)), e('e4', 'on', at(4, 90), late));
    const res = T.match(flow, run, ev);
    const r2 = row(res, 'L02');
    assert.deepStrictEqual(r2.traces.map((t) => [t.what, t.ms, t.mark, t.notWhen]), [[late.what, at(3, 20), 'likely', true]]);
    assert.strictEqual(r2.pressedAfter, null);
    assert.deepStrictEqual([row(res, 'L03').traces[0].what, row(res, 'L03').mark], ['upplåst', 'likely']);
    // Efter det sista steget finns inget nästa: då gäller fönstret som vanligt.
    assert.strictEqual(row(res, 'L04').mark, 'none');
});

test('en bild med QR-koden är säker, och telefonens klocka räknas ur bilderna', () => {
    const { flow, run, a, b } = lab([['photo', 'A'], ['photo', 'A'], ['photo', 'B'], ['text', 'A', 'WhatsApp']]);
    const ev = { [a]: empty(), [b]: empty() };
    const pic = (key, ms, qr, more) => Object.assign({ key, base: 'external.db', col: 'datetaken', name: key + '.jpg', kind: 'photo', ms, qr: qr || null, thumb: 'data:' + key }, more || {});
    // Samsungs klocka går 20 sekunder före datorns: bilderna av L01 och L02 togs 3 och 5 sekunder före trycken.
    ev[a].media.push(pic('p2', at(2, -5) + 20000, { code: 'L02', t: at(2, -6) + 500 }), pic('p1', at(1, -3) + 20000, { code: 'L01', t: at(1, -4) + 500 }));
    ev[b].media.push(pic('p3', at(3, -2)));
    ev[a].messages.push(msg({ fromMe: true, codes: ['L04'], times: times({ written: at(4, -2) + 20000 }) }));
    const res = T.match(flow, run, ev);
    assert.deepStrictEqual(res.clocks, { [a]: { ms: 20000, n: 2 } });
    assert.deepStrictEqual(row(res, 'L01').traces.map((t) => [t.what, t.item.key, t.mark, t.thumb, t.qr.code]), [['bilden tagen', 'p1', 'sure', 'data:p1', 'L01']]);
    assert.strictEqual(row(res, 'L02').traces[0].item.key, 'p2');
    // Trycket räknas mot telefonens tid omräknad till datorns klocka.
    assert.strictEqual(row(res, 'L01').pressedAfter, 3000);
    assert.strictEqual(row(res, 'L04').pressedAfter, 2000);
    assert.deepStrictEqual(row(res, 'L03').traces.map((t) => [t.item.key, t.mark]), [['p3', 'likely']]);
    assert.deepStrictEqual(res.delay, { ms: 3000, n: 3 });
    const facts = T.facts(flow, run, res, { [a]: 'samsung.zip' });
    assert.deepStrictEqual(facts.filter((f) => f[0] === 'Telefonens klocka mot datorns')[0][1], 'Samsung +20,0 s (2 bilder av rutan). Varje bild är osäker en halv sekund.');
    assert.strictEqual(facts.filter((f) => f[0] === 'Extraktion Samsung')[0][1], 'samsung.zip');
    assert.strictEqual(facts.filter((f) => f[0] === 'Extraktion iPhone')[0][1], 'inte vald');
});

test('utan kod: ett enda spår i fönstret är troligt, flera får användaren välja bland, och inget är inte hittat', () => {
    const { flow, run, a } = lab([['photo', 'A'], ['photo', 'A'], ['screenshot', 'A', 'Signal'], ['video', 'A']]);
    const ev = { [a]: empty() };
    const file = (key, kind, ms) => ({ key, base: 'external.db', col: 'datetaken', name: key, kind, ms, qr: null, thumb: '' });
    ev[a].media.push(file('p1', 'photo', at(1, -20)), file('p2', 'photo', at(1, -8)), file('p3', 'photo', at(2, -8)), file('s1', 'screenshot', at(3, 20)), file('v1', 'video', at(4, -200)), file('v2', 'video', at(4, 61)));
    const res = T.match(flow, run, ev);
    const r1 = row(res, 'L01');
    // Det sista före trycket föreslås.
    assert.deepStrictEqual([r1.mark, r1.traces[0].item.key, r1.traces[0].options.map((o) => o.key)], ['many', 'p2', ['p1', 'p2', 'p3']]);
    // Bilden som L01 fick är upptagen, och p1 ligger före L01:s spår: kvar för L02 är p3.
    assert.deepStrictEqual([row(res, 'L02').mark, row(res, 'L02').traces[0].item.key], ['likely', 'p3']);
    // Ett spår efter trycket duger när inget finns före.
    assert.deepStrictEqual([row(res, 'L03').mark, row(res, 'L03').traces[0].item.key, row(res, 'L03').pressedAfter], ['likely', 's1', -20000]);
    assert.strictEqual(row(res, 'L04').mark, 'none');
    assert.deepStrictEqual(res.summary, { sure: 0, chosen: 0, likely: 2, many: 1, none: 1, wait: 0, off: 0 });

    // Användaren väljer p1 för L01. Då är p2 ledig, och L02 har två att välja på.
    const again = T.match(flow, run, ev, { chosen: { [r1.traces[0].slot]: 'p1' } });
    assert.deepStrictEqual([row(again, 'L01').mark, row(again, 'L01').traces[0].item.key], ['chosen', 'p1']);
    assert.deepStrictEqual([row(again, 'L02').mark, row(again, 'L02').traces[0].item.key], ['many', 'p3']);

    // Fönstret går att ändra: med fyra minuter före och två efter ryms båda videorna. Den första ligger före
    // skärmdumpen i L03 och kan därför inte höra till L04, men den står kvar bland dem som går att välja.
    const wide = T.match(flow, run, ev, { before: 240, after: 120 });
    assert.deepStrictEqual([row(wide, 'L04').mark, row(wide, 'L04').traces[0].item.key, row(wide, 'L04').traces[0].options.map((o) => o.key)], ['likely', 'v2', ['v1', 'v2']]);
    assert.deepStrictEqual([wide.before, wide.after], [240, 120]);
    const narrow = T.match(flow, run, ev, { before: 10, after: 0 });
    assert.deepStrictEqual([row(narrow, 'L01').mark, row(narrow, 'L01').traces[0].item.key], ['likely', 'p2']);
    assert.strictEqual(row(narrow, 'L03').mark, 'none');
});

test('lås, upplåsning, av och på hittas i enhetens händelser, och en enhet som redan var låst visas som låst', () => {
    const { flow, run, a, b } = lab([['home-lock', 'A'], ['unlock', 'A'], ['lock', 'B'], ['power-off', 'A'], ['power-on', 'A'], ['unlock', 'B']]);
    const ev = { [a]: empty(), [b]: empty() };
    const e = (key, kind, ms) => ({ key, base: 'usagestats', col: 'händelse ' + kind, kind, ms });
    ev[a].events.push(e('e1', 'lock', at(1, -2)), e('e2', 'unlock', at(2, -3)), e('e3', 'off', at(4, -6)), e('e4', 'on', at(5, -20)), e('e5', 'unlock', at(5, -1)));
    ev[b].locks.push({ key: 'k1', base: 'knowledgeC.db', col: '/device/isLocked', startMs: at(0), endMs: at(6, -4) });
    ev[b].events.push({ key: 'k1e', base: 'knowledgeC.db', col: '/device/isLocked', kind: 'unlock', ms: at(6, -4) });
    const res = T.match(flow, run, ev);
    assert.deepStrictEqual(['L01', 'L02', 'L04', 'L05', 'L06'].map((c) => [row(res, c).traces[0].what, row(res, c).traces[0].ms, row(res, c).mark]),
        [['låst', at(1, -2), 'likely'], ['upplåst', at(2, -3), 'likely'], ['avstängd', at(4, -6), 'likely'], ['startad', at(5, -20), 'likely'], ['upplåst', at(6, -4), 'likely']]);
    const r3 = row(res, 'L03');
    assert.deepStrictEqual([r3.traces[0].what, r3.traces[0].ms, r3.traces[0].endMs, r3.mark, r3.pressedAfter], ['låst', at(0), at(6, -4), 'likely', null]);
    assert.strictEqual(T.traceLine(r3.traces[0], 60), 'iPhone 13:00:00–13:05:56 låst (trolig)');
});

test('en app som programmet inte läser ger tiden då appen var framme, och steg utan något att söka märks så', () => {
    const { flow, run, a, b } = lab([['text', 'A', 'Wickr'], ['open-app', 'B', 'Bilder'], ['zone', 'A'], ['install', 'A', 'Wickr'], ['custom', 'A'], ['flight-on', 'A'], ['text', 'A', 'Wickr'], ['text', 'A', 'WhatsApp']], { skipped: ['L07'], left: 1 });
    const ev = { [a]: empty(), [b]: empty() };
    const front = (key, app, from, to) => ({ key, base: 'usagestats', col: '', app, startMs: from, endMs: to });
    ev[a].apps.push(front('a1', 'com.wickr.pro', at(1, -40), at(1, 5)), front('a2', 'com.android.settings', at(3, -30), at(3, -20)), front('a3', 'com.android.settings', at(3, -15), at(3, 2)), front('a4', 'com.sec.android.app.launcher', at(2, 0), at(2, 30)));
    ev[b].apps.push(front('b1', 'com.apple.mobileslideshow', at(2, -5), null));
    const res = T.match(flow, run, ev);
    const r1 = row(res, 'L01');
    assert.deepStrictEqual(r1.traces.map((t) => [t.deviceName, t.what, t.ms, t.endMs, t.mark]), [['Samsung', 'appen framme', at(1, -40), at(1, 5), 'likely'], ['iPhone', '', null, undefined, 'none']]);
    assert.strictEqual(r1.traces[0].source, 'usagestats');
    // En tid utan slut pågår fortfarande.
    assert.deepStrictEqual([row(res, 'L02').mark, T.traceLine(row(res, 'L02').traces[0], 60)], ['likely', 'iPhone 13:01:55– appen framme (trolig)']);
    // Två gånger framme i fönstret: den som pågick när det trycktes.
    assert.deepStrictEqual([row(res, 'L03').mark, row(res, 'L03').traces[0].item.key, row(res, 'L03').traces[0].options.length], ['likely', 'a3', 2]);
    assert.deepStrictEqual(['L04', 'L05', 'L06', 'L07', 'L08'].map((c) => row(res, c).mark), ['off', 'off', 'off', 'off', 'off']);
    assert.strictEqual(T.cells(row(res, 'L04'))[3], 'söks inte');
    assert.deepStrictEqual(T.cells(row(res, 'L07')).slice(2), ['hoppad', '', '']);
    assert.deepStrictEqual(T.cells(row(res, 'L08')).slice(2), ['', '', '']);
});

test('tabellen till Word har fem kolumner, och CSV-filen en rad per spår med tiderna också i UTC', () => {
    const { flow, run, a, b } = lab([['text', 'A', 'WhatsApp'], ['photo', 'B'], ['custom', 'A']]);
    const ev = { [a]: empty(), [b]: empty() };
    ev[a].messages.push(msg({ fromMe: true, codes: ['L01'], times: times({ written: at(1, -4) }) }));
    ev[b].messages.push(msg({ base: '=Chat<Storage>.sqlite', codes: ['L01'], times: times({ date: at(1, -3) }) }));
    const res = T.match(flow, run, ev);
    assert.deepStrictEqual(T.HEAD, ['Kod', 'Åtgärd', 'Loggens tid', 'Telefonens tid', 'Källa']);
    assert.deepStrictEqual(T.cells(row(res, 'L01')), ['L01', 'Skickade texten L01 till iPhone i WhatsApp.', '13:01:00', 'Samsung 13:00:56 skickat\niPhone 13:00:57 mottaget',
        'Samsung: msgstore.db · message.written\niPhone: =Chat<Storage>.sqlite · message.date']);
    assert.strictEqual(T.cells(row(res, 'L02'))[3], 'iPhone: inte hittad');
    const p = T.protocol(flow, run, res, { [a]: 'a.zip', [b]: 'b.zip' });
    assert.strictEqual((p.html.match(/<th /g) || []).length, 5);
    assert.ok(p.html.includes('Samsung 13:00:56 skickat<br>iPhone 13:00:57 mottaget'));
    assert.ok(p.html.includes('=Chat&lt;Storage&gt;.sqlite') && !p.html.includes('<Storage>'));
    assert.ok(p.text.includes('L01\tSkickade texten L01 till iPhone i WhatsApp.\t13:01:00\tSamsung 13:00:56 skickat / iPhone 13:00:57 mottaget\t'));
    assert.ok(p.text.includes('Steg: 1 säker, 1 inte hittad, 1 söks inte'));
    assert.ok(p.text.includes('Sökning: Ett spår utan kod söks från 3 min 0 s före till 1 min 0 s efter loggens tid.'));
    assert.ok(p.text.includes('Tryck efter telefonens tid: Median 4 s i 1 säkert steg.'));
    const csv = T.toCsv(res).split('\r\n');
    assert.strictEqual(csv[0], 'Kod;Åtgärd;Loggens tid;Loggens tid UTC;Enhet;Telefonens tid;Telefonens tid UTC;Till;Vad;Märke;Tryckt efter (s);Källa');
    assert.strictEqual(csv[1], 'L01;Skickade texten L01 till iPhone i WhatsApp.;13:01:00;2026-11-12T12:01:00.000Z;Samsung;13:00:56;2026-11-12T12:00:56.000Z;;skickat;säker;4.0;msgstore.db · message.written');
    // En källa som börjar som en formel får en apostrof först.
    assert.ok(csv[2].endsWith(";mottaget;säker;3.0;'=Chat<Storage>.sqlite · message.date"));
    assert.strictEqual(csv[3], 'L02;Tog en bild av skärmen med kameran.;13:02:00;2026-11-12T12:02:00.000Z;iPhone;;;;;inte hittad;;');
    assert.strictEqual(csv[4], 'L03;;13:03:00;2026-11-12T12:03:00.000Z;Samsung;;;;;söks inte;;');
    assert.strictEqual(csv.length, 6);
});
