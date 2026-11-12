const test = require('node:test');
const assert = require('node:assert');
const L = require('./lab-core.js');

const ALLA = L.BLOCKS.map((b) => b.id);
const H = 3600000;
// 2026-11-12 13:00:00 svensk vintertid, som millisekunder. Testerna ger alltid klockan själva: { t, off }.
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const at = (seconds, off) => ({ t: T0 + seconds * 1000, off: off == null ? 60 : off });

function flowAB(blocks, apps) {
    return L.buildFlow({ name: 'Prov', prefix: 'L', devices: ['Samsung', 'iPhone'], pair: [0, 1], apps: apps || ['WhatsApp'], blocks: blocks || ['chat-text'] });
}

test('ett standardflöde får koder i ordning och texter utan kvarglömda platshållare', () => {
    const flow = flowAB(ALLA, ['WhatsApp', 'Signal']);
    const steps = L.view(flow);
    assert.strictEqual(steps.length, 60);
    assert.deepStrictEqual(steps.slice(0, 3).map((s) => s.code), ['L01', 'L02', 'L03']);
    assert.strictEqual(steps[59].code, 'L60');
    for (const s of steps) {
        for (const text of [s.do, s.done, s.press]) {
            assert.ok(text.length > 0, s.code);
            assert.ok(!/[{}]/.test(text), s.code + ': ' + text);
        }
        assert.ok(s.deviceName, s.code);
    }
    assert.strictEqual(steps[2].do, 'Skriv L03 till iPhone och skicka.');
    assert.strictEqual(steps[2].done, 'Skickade texten L03 till iPhone i WhatsApp.');
    assert.strictEqual(steps[2].block, 'WhatsApp: text åt båda håll, och läst');
    assert.deepStrictEqual(steps[2].parts.filter((p) => p.code).map((p) => p.text), ['L03']);
});

test('varje byggsten har text, och varje standardflöde ger steg', () => {
    for (const a of L.ACTIONS) {
        assert.ok(a.label && a.press, a.id);
        if (a.id !== 'custom') assert.ok(a.do && a.done, a.id);
    }
    for (const b of L.BLOCKS) {
        assert.ok(b.label && b.desc, b.id);
        assert.ok(flowAB([b.id]).steps.length > 0, b.id);
    }
});

test('chattarna görs app för app efter klockorna i början och före det som görs på en enhet', () => {
    const flow = flowAB(['clock-end', 'camera', 'chat-delete', 'chat-text', 'clock-start'], ['Signal', 'Telegram']);
    const blocks = [...new Set(flow.steps.map((s) => s.block))];
    assert.deepStrictEqual(blocks, ['Klockorna i början', 'Signal: text åt båda håll, och läst', 'Signal: raderat meddelande', 'Telegram: text åt båda håll, och läst',
        'Telegram: raderat meddelande', 'Kamera och skärmdump', 'Klockorna i slutet']);
});

test('raderingen pekar på meddelandet före, och väntan ligger efter det sista steget i sin del', () => {
    const steps = L.view(flowAB(['chat-delete', 'lock-power']));
    assert.strictEqual(steps[0].do, 'Skriv L01 raderas till iPhone och skicka.');
    assert.strictEqual(steps[1].do, 'Radera meddelandet L01 raderas för alla.');
    assert.deepStrictEqual(steps.filter((s) => s.wait).map((s) => [s.code, s.deviceName, s.wait]), [['L03', 'Alla enheter', 300], ['L07', 'iPhone', 600], ['L09', 'iPhone', 180]]);
});

test('en ensam enhet får inga chattsteg, och samma app två gånger räknas en gång', () => {
    const one = L.buildFlow({ devices: ['Samsung'], apps: ['WhatsApp'], blocks: ALLA });
    assert.ok(one.steps.length > 0);
    assert.ok(one.steps.every((s) => !L.ACTION[s.action].chat));
    assert.strictEqual(L.buildFlow({ devices: ['A', 'B'], pair: [1, 1], apps: ['WhatsApp'], blocks: ['chat-text'] }).steps.length, 0);
    assert.deepStrictEqual(L.cleanApps(['Signal', ' signal ', '', 'Wire']), ['Signal', 'Wire']);
    assert.strictEqual(flowAB(['chat-text'], ['Signal', 'signal']).steps.length, 4);
});

test('tre enheter: chatten går mellan de två valda, resten görs på alla', () => {
    const flow = L.buildFlow({ devices: ['A', 'B', 'C'], pair: [2, 0], apps: ['Signal'], blocks: ['clock-start', 'chat-text'] });
    const steps = L.view(flow);
    assert.deepStrictEqual(steps.slice(0, 3).map((s) => s.deviceName), ['A', 'B', 'C']);
    assert.strictEqual(steps[3].do, 'Skriv L04 till A och skicka.');
    assert.strictEqual(steps[3].deviceName, 'C');
});

test('ett nytt namn på enheten slår igenom i alla steg', () => {
    const flow = flowAB();
    flow.devices[1].name = 'Vittnets telefon';
    const steps = L.view(flow);
    assert.strictEqual(steps[0].done, 'Skickade texten L01 till Vittnets telefon i WhatsApp.');
    assert.strictEqual(steps[1].deviceName, 'Vittnets telefon');
});

test('koderna räknas om när steg flyttas, läggs till och tas bort', () => {
    const flow = flowAB();
    const first = flow.steps[0].id;
    assert.strictEqual(L.moveStep(flow, first, -1), false);
    assert.strictEqual(L.moveStep(flow, first, 1), true);
    assert.strictEqual(L.view(flow)[1].do, 'Skriv L02 till iPhone och skicka.');
    const own = L.addStep(flow, 'custom', { device: flow.devices[0].id, do: 'Starta om enheten och skriv {kod} i Anteckningar.' }, 0);
    assert.strictEqual(L.view(flow)[0].do, 'Starta om enheten och skriv L01 i Anteckningar.');
    assert.strictEqual(L.view(flow)[0].done, 'Starta om enheten och skriv L01 i Anteckningar.', 'utan egen text för protokollet gäller instruktionen');
    assert.strictEqual(L.view(flow)[2].do, 'Skriv L03 till iPhone och skicka.');
    L.removeStep(flow, own.id);
    assert.strictEqual(L.view(flow).length, 4);
    assert.strictEqual(L.view(flow)[1].code, 'L02');
    const ids = new Set(flow.steps.map((s) => s.id));
    assert.strictEqual(ids.size, flow.steps.length);
});

test('ett eget steg sist ärver delen av steget före, och hundra steg ger tre siffror', () => {
    const flow = flowAB();
    assert.strictEqual(L.addStep(flow, 'photo', { device: flow.devices[0].id }).block, 'WhatsApp: text åt båda håll, och läst');
    for (let n = 0; n < 95; n++) L.addStep(flow, 'photo', { device: flow.devices[0].id });
    const steps = L.view(flow);
    assert.strictEqual(steps.length, 100);
    assert.strictEqual(steps[0].code, 'L001');
    assert.strictEqual(steps[99].code, 'L100');
});

test('ett steg kan ändras: enhet, texter och väntan städas som när det skapades', () => {
    const flow = flowAB();
    const id = flow.steps[0].id;
    assert.strictEqual(L.updateStep(flow, id, { device: L.ALL, other: 'd99', app: ' Wire ', do: 'Skriv {kod} i {app}.', done: '', press: 'när det syns', wait: '90' }), true);
    assert.strictEqual(L.updateStep(flow, id, { device: 'd99' }), true);
    const s = L.view(flow)[0];
    assert.deepStrictEqual([s.deviceName, s.app, s.do, s.done, s.press, s.wait], ['Alla enheter', 'Wire', 'Skriv L01 i Wire.', 'Skriv L01 i Wire.', 'när det syns', 90]);
    assert.strictEqual(flow.steps[0].other, '');
    assert.strictEqual(L.updateStep(flow, 'finns-inte', { wait: 1 }), false);
    L.updateStep(flow, id, { wait: -5 });
    assert.strictEqual(flow.steps[0].wait, 0);
});

test('listan att skriva ut har alla steg, väntan och en tom ruta, och skriver namn som text', () => {
    const flow = L.buildFlow({ name: '<u>Prov</u>', devices: ['<b>A</b>', 'B'], apps: ['<i>X</i>'], blocks: ['chat-text', 'lock-power'] });
    const html = L.checklist(flow);
    assert.ok(!/<u>|<b>A|<i>/.test(html), html);
    assert.strictEqual((html.match(/<tr>/g) || []).length, 1 + 2 + flow.steps.length);
    assert.ok(html.includes('13 steg, ungefär 27 minuter varav 18 minuter väntan.'));
    assert.ok(html.includes('<b>Vänta sedan 5:00.</b>'));
    assert.ok(html.includes('Klart när meddelandet är skickat.'));
});

test('en borttagen enhet tar sina steg med sig, och motparten blir utan namn', () => {
    const flow = flowAB();
    L.removeDevice(flow, flow.devices[1].id);
    const steps = L.view(flow);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].do, 'Skriv L01 till den andra enheten och skicka.');
});

test('kodbokstaven städas, och uppskattningen räknar steg och väntan', () => {
    assert.strictEqual(L.cleanPrefix(' k2<'), 'K');
    assert.strictEqual(L.cleanPrefix('1'), 'L');
    assert.strictEqual(L.cleanPrefix('åb'), 'ÅB');
    assert.deepStrictEqual(L.estimate(flowAB(['lock-power'])), { steps: 9, waitS: 1080, totalS: 9 * 40 + 1080 });
});

test('tiden skrivs i datorns zon vid trycket, oberoende av zonen där testet körs', () => {
    assert.strictEqual(L.isoLocal(T0, 60), '2026-11-12T13:00:00.000+01:00');
    assert.strictEqual(L.timeText(T0 + 11 * H, 60), '00:00:00');
    assert.strictEqual(L.dateText(T0 + 11 * H, 60), '2026-11-13');
    assert.strictEqual(L.isoLocal(T0, -210), '2026-11-12T08:30:00.000-03:30');
    assert.strictEqual(L.offsetText(0), '+00:00');
    assert.strictEqual(L.spanText(125), '2:05');
    const now = L.clockNow(new Date(T0));
    assert.strictEqual(now.t, T0);
    assert.strictEqual(now.off, -new Date(T0).getTimezoneOffset());
});

test('tryck loggas i flödets ordning, och ett hoppat steg får ingen väntan', () => {
    const flow = flowAB(['lock-power']);
    const run = L.newRun(at(0), 'Europe/Stockholm');
    assert.strictEqual(L.press(flow, run, at(10), 'hoppad'), true);
    assert.strictEqual(run.waitUntil, 0);
    assert.strictEqual(L.undo(run, at(12)), true);
    assert.strictEqual(L.press(flow, run, at(20), 'klar'), true);
    assert.strictEqual(L.isWaiting(run, at(21).t), true);
    assert.strictEqual(L.press(flow, run, at(30), 'klar'), false, 'inget tryck under väntan');
    assert.strictEqual(run.entries.length, 1);
    assert.strictEqual(L.press(flow, run, at(321), 'klar'), true, 'väntan är slut efter 300 s');
    assert.deepStrictEqual(run.entries.map((e) => e.step), flow.steps.slice(0, 2).map((s) => s.id));
    assert.strictEqual(run.undone.length, 1);
    assert.strictEqual(run.undone[0].status, 'hoppad');
});

test('en avbruten väntan syns på raden, och ångra tar bort väntan', () => {
    const flow = flowAB(['lock-power']);
    const run = L.newRun(at(0), '');
    L.press(flow, run, at(5), 'klar');
    assert.strictEqual(L.cutWait(run, at(65)), true);
    assert.strictEqual(L.cutWait(run, at(66)), false);
    assert.strictEqual(L.rows(flow, run)[0].remark, 'Väntan därefter avbröts efter 1:00 av 5:00.');
    L.undo(run, at(70));
    L.press(flow, run, at(80), 'klar');
    assert.strictEqual(L.isWaiting(run, at(81).t), true);
    L.undo(run, at(82));
    assert.strictEqual(L.isWaiting(run, at(83).t), false);
    assert.strictEqual(L.undo(run, at(84)), false);
});

test('när alla steg är gjorda tas inga fler tryck emot', () => {
    const flow = flowAB();
    const run = L.newRun(at(0), '');
    for (let n = 0; n < 4; n++) assert.strictEqual(L.press(flow, run, at(10 + n), 'klar'), true);
    assert.strictEqual(L.isDone(flow, run), true);
    assert.strictEqual(L.press(flow, run, at(20), 'klar'), false);
});

function sampleRun(flow) {
    const run = L.newRun(at(0), 'Europe/Stockholm');
    L.press(flow, run, at(60), 'klar');
    L.addNote(flow, run, at(75), 'Tog en bild för mycket med kameran.', flow.devices[1].id);
    L.press(flow, run, at(90), 'hoppad');
    L.press(flow, run, at(150), 'klar');
    L.toggleApprox(run);
    L.addNote(flow, run, at(155), 'Paus.', '');
    return run;
}

test('tabellen: gjorda steg, anteckningar i tidsordning, hoppat och inte nått sist', () => {
    const flow = flowAB();
    const list = L.rows(flow, sampleRun(flow));
    assert.deepStrictEqual(list.map((r) => L.cells(r)), [
        ['13:01:00', 'Samsung', 'Skickade texten L01 till iPhone i WhatsApp.', 'L01', ''],
        ['13:01:15', 'iPhone', 'Utöver flödet: Tog en bild för mycket med kameran.', '', ''],
        ['inte utförd', 'iPhone', 'Lås upp, öppna WhatsApp och chatten med Samsung, så att meddelandena blir lästa.', 'L02', 'Hoppades över 13:01:30.'],
        ['ca 13:02:30', 'iPhone', 'Skickade texten L03 till Samsung i WhatsApp.', 'L03', 'Tiden är ungefärlig: knappen trycktes senare än åtgärden gjordes.'],
        ['13:02:35', '', 'Anteckning: Paus.', '', ''],
        ['inte utförd', 'Samsung', 'Lås upp, öppna WhatsApp och chatten med iPhone, så att meddelandena blir lästa.', 'L04', 'Laborationen avslutades före steget.'],
    ]);
    assert.deepStrictEqual(list.map((r) => r.kind), ['step', 'note', 'skipped', 'step', 'note', 'left']);
});

test('ungefärlig tid gäller bara ett gjort steg, och ett andra tryck tar bort märket', () => {
    const flow = flowAB();
    const run = L.newRun(at(0), '');
    assert.strictEqual(L.toggleApprox(run), null);
    L.press(flow, run, at(5), 'klar');
    assert.strictEqual(L.toggleApprox(run), true);
    assert.strictEqual(L.toggleApprox(run), false);
    L.press(flow, run, at(6), 'hoppad');
    assert.strictEqual(L.toggleApprox(run), null);
});

test('den egna anmärkningen står sist på raden, och en tom anteckning sparas inte', () => {
    const flow = flowAB(['lock-power']);
    const run = L.newRun(at(0), '');
    L.press(flow, run, at(5), 'klar');
    assert.strictEqual(L.setRemark(run, flow.steps[0].id, '  Skärmen var redan släckt. '), true);
    assert.strictEqual(L.setRemark(run, 'finns-inte', 'x'), false);
    assert.strictEqual(L.rows(flow, run)[0].remark, 'Därefter väntan 5:00. Skärmen var redan släckt.');
    assert.strictEqual(L.addNote(flow, run, at(6), '   ', ''), false);
    assert.strictEqual(run.notes.length, 0);
});

test('över midnatt får varje rad sitt datum', () => {
    const flow = flowAB();
    const run = L.newRun(at(11 * 3600 - 30), '');
    L.press(flow, run, at(11 * 3600 - 10), 'klar');
    L.press(flow, run, at(11 * 3600 + 10), 'klar');
    const list = L.rows(flow, run);
    assert.strictEqual(list[0].time, '2026-11-12 23:59:50');
    assert.strictEqual(list[1].time, '2026-11-13 00:00:10');
    assert.strictEqual(L.facts(flow, run, '')[1][1], '2026-11-12 till 2026-11-13');
});

test('uppgifterna ovanför tabellen räknar rätt och säger vilken klocka som gäller', () => {
    const flow = flowAB();
    const run = sampleRun(flow);
    L.undo(run, at(200));
    L.press(flow, run, at(210, 120), 'klar');
    const f = Object.fromEntries(L.facts(flow, run, 'Forensics Toolbox 1.59'));
    assert.strictEqual(f.Laboration, 'Prov');
    assert.strictEqual(f.Datum, '2026-11-12');
    assert.strictEqual(f.Tid, '13:00:00 till 14:03:30');
    assert.strictEqual(f.Klocka, 'Datorns klocka, tidszon Europe/Stockholm (UTC+01:00 och UTC+02:00). Tiden på en rad är när undersökaren tryckte att steget var gjort.');
    assert.strictEqual(f.Enheter, 'Samsung, iPhone');
    assert.strictEqual(f.Steg, '2 utförda, 2 inte utförda, 2 anteckningar');
    assert.strictEqual(f['Ångrat'], '1 tryck ångrades under laborationen. De står i loggfilen.');
    assert.strictEqual(f.Program, 'Forensics Toolbox 1.59');
});

test('protokollet skriver namn och anteckningar som text, aldrig som HTML', () => {
    const flow = L.buildFlow({ name: '<img src=x onerror=alert(1)>', devices: ['<b>A</b>', 'B & "C"'], apps: ['<i>App</i>'], blocks: ['chat-text'] });
    const run = L.newRun(at(0), '<zon>');
    L.press(flow, run, at(5), 'klar');
    L.addNote(flow, run, at(6), '<script>alert(2)</script>', '');
    const p = L.protocol(flow, run, '<p>');
    assert.ok(!/<img|<b>A|<i>|<script|<zon>|<p>/.test(p.html), p.html);
    assert.ok(p.html.includes('&lt;b&gt;A&lt;/b&gt;'));
    assert.ok(p.html.includes('B &amp; &quot;C&quot;'));
    assert.strictEqual((p.html.match(/<tr>/g) || []).length, L.facts(flow, run, '<p>').length - 1 + 1 + L.rows(flow, run).length);
    assert.ok(p.text.includes('Tid\tEnhet\tÅtgärd\tKod\tAnmärkning\n13:00:05\t<b>A</b>\t'));
});

test('CSV: semikolon, citat kring det som behöver det och skydd mot formler', () => {
    const flow = flowAB();
    const run = L.newRun(at(0), '');
    L.press(flow, run, at(5), 'klar');
    L.toggleApprox(run);
    L.addNote(flow, run, at(6), '=SUM(A1); "citat"', '');
    const lines = L.toCsv(flow, run).split('\r\n');
    assert.strictEqual(lines[0], 'Datum;Tid;UTC;Enhet;App;Åtgärd;Kod;Status;Anmärkning');
    assert.strictEqual(lines[1], '2026-11-12;13:00:05;2026-11-12T12:00:05.000Z;Samsung;WhatsApp;Skickade texten L01 till iPhone i WhatsApp.;L01;utförd, tiden ungefärlig;Tiden är ungefärlig: knappen trycktes senare än åtgärden gjordes.');
    assert.strictEqual(lines[2], '2026-11-12;13:00:06;2026-11-12T12:00:06.000Z;;;"Anteckning: =SUM(A1); ""citat""";;anteckning;');
    assert.ok(lines[3].startsWith(';;;iPhone;WhatsApp;'));
    assert.strictEqual(L.toCsv(flow, L.newRun(at(0), '')).split('\r\n')[1].split(';')[7], 'inte utförd');
    const own = L.emptyFlow('x', 'L', ['A']);
    L.addStep(own, 'custom', { device: own.devices[0].id, do: '-1+2' });
    assert.ok(L.toCsv(own, L.newRun(at(0), '')).includes(";'-1+2;"));
});

test('filen bär flödet och loggen, och kommer tillbaka likadan', () => {
    const flow = flowAB(['chat-text', 'lock-power']);
    const run = sampleRun(flow);
    L.setRemark(run, flow.steps[0].id, 'Egen anmärkning.');
    L.undo(run, at(160));
    const file = L.toFile(flow, run, 'Forensics Toolbox 1.59', at(300));
    assert.strictEqual(file.format, 'forensics-toolbox-laboration');
    assert.strictEqual(file.sparad, '2026-11-12T13:05:00.000+01:00');
    assert.strictEqual(file.rader[0].tid, '2026-11-12T13:01:00.000+01:00');
    assert.strictEqual(file.rader[0].utc, '2026-11-12T12:01:00.000Z');
    assert.strictEqual(file.rader[0].status, 'utförd');
    assert.strictEqual(file.rader[2].tid, null);
    const back = L.fromFile(JSON.stringify(file));
    assert.deepStrictEqual(back.flow, flow);
    assert.deepStrictEqual(back.run, run);
    assert.deepStrictEqual(L.rows(back.flow, back.run), L.rows(flow, run));
    const alone = L.fromFile(JSON.stringify(L.toFile(flow, null, '', at(0))));
    assert.strictEqual(alone.run, null);
    assert.deepStrictEqual(alone.flow, flow);
    assert.strictEqual(L.addStep(alone.flow, 'photo', { device: alone.flow.devices[0].id }).id, 's' + flow.next, 'nya id krockar inte med filens');
});

test('en väntan som pågick när filen sparades gäller fortfarande när den öppnas', () => {
    const flow = flowAB(['lock-power']);
    const run = L.newRun(at(0), '');
    L.press(flow, run, at(5), 'klar');
    const back = L.fromFile(JSON.stringify(L.toFile(flow, run, '', at(6))));
    assert.strictEqual(L.isWaiting(back.run, at(100).t), true);
    assert.strictEqual(L.isWaiting(back.run, at(306).t), false);
});

test('filnamnet säger om det är ett flöde eller en logg', () => {
    const flow = L.emptyFlow('Två telefoner: Signal/WhatsApp', 'L', ['A']);
    assert.strictEqual(L.fileName(flow, null, 'json'), 'flode-Två-telefoner-Signal-WhatsApp.json');
    assert.strictEqual(L.fileName(flow, L.newRun(at(0), ''), 'csv'), 'laboration-2026-11-12-Två-telefoner-Signal-WhatsApp.csv');
    assert.strictEqual(L.fileName(L.emptyFlow('../..', 'L', []), null, 'json'), 'flode-laboration.json');
});

test('en fil som inte stämmer avvisas med ett begripligt fel', () => {
    const flow = flowAB();
    const run = L.newRun(at(0), '');
    L.press(flow, run, at(5), 'klar');
    const good = () => JSON.parse(JSON.stringify(L.toFile(flow, run, '', at(9))));
    const bad = (change, message) => {
        const o = good();
        change(o);
        assert.throws(() => L.fromFile(JSON.stringify(o)), { message });
    };
    assert.throws(() => L.fromFile('inte json'), { message: 'Filen är inte JSON.' });
    assert.throws(() => L.fromFile('null'), { message: 'Filen är inte ett flöde eller en logg från Laboration.' });
    bad((o) => { o.format = 'annat'; }, 'Filen är inte ett flöde eller en logg från Laboration.');
    bad((o) => { o.version = 2; }, 'Filen är skriven av en nyare version av programmet.');
    bad((o) => { o.flow.steps = 'x'; }, 'Flödet i filen saknar enheter eller steg.');
    bad((o) => { o.flow.devices[1].id = o.flow.devices[0].id; }, 'En enhet i filen saknar ett giltigt id.');
    bad((o) => { o.flow.steps[0].id = '__proto__'; }, 'Ett steg i filen saknar ett giltigt id.');
    bad((o) => { o.flow.steps[0].device = 'd99'; }, 'Ett steg i filen pekar på en enhet som inte finns.');
    bad((o) => { o.flow.steps = new Array(501).fill(o.flow.steps[0]); }, 'Flödet i filen har för många enheter eller steg.');
    bad((o) => { o.run.entries[0].t = 'nu'; }, 'En rad i loggen saknar en giltig tid.');
    bad((o) => { o.run.entries[0].step = o.flow.steps[1].id; }, 'Loggen i filen hör inte till flödet i samma fil.');
    bad((o) => { o.run.entries = new Array(5).fill(o.run.entries[0]); }, 'Loggen i filen går inte att läsa.');
    bad((o) => { o.run.started = -1; }, 'Loggen i filen går inte att läsa.');
});

test('en fil kan inte smuggla in långa texter, okända fält eller styrtecken', () => {
    const flow = flowAB();
    const o = JSON.parse(JSON.stringify(L.toFile(flow, null, '', at(0))));
    o.flow.name = 'x'.repeat(5000);
    o.flow.prefix = '<script>';
    o.flow.steps[0].do = 'a' + String.fromCharCode(0, 7, 27) + 'b' + 'c'.repeat(5000);
    o.flow.steps[0].wait = 1e12;
    o.flow.steps[0].action = 'finns-inte';
    o.flow.steps[0].extra = { a: 1 };
    o.flow.steps[1].wait = 'länge';
    const back = L.fromFile(JSON.stringify(o)).flow;
    assert.strictEqual(back.name.length, L.LIMITS.name);
    assert.strictEqual(back.prefix, 'SCR');
    assert.ok(back.steps[0].do.startsWith('abccc'));
    assert.strictEqual(back.steps[0].do.length, L.LIMITS.text);
    assert.strictEqual(back.steps[0].wait, L.LIMITS.wait);
    assert.strictEqual(back.steps[0].action, 'custom');
    assert.strictEqual(back.steps[0].extra, undefined);
    assert.strictEqual(back.steps[1].wait, 0);
});

test('ett mycket långt ord får brytas i tabellerna, och vanliga namn lämnas hela', () => {
    assert.deepStrictEqual(L.softParts('Samsung Galaxy S23'), ['Samsung Galaxy S23']);
    assert.deepStrictEqual(L.softParts('a'.repeat(20) + ' ' + 'b'.repeat(20)), ['a'.repeat(20) + ' ' + 'b'.repeat(20)]);
    assert.deepStrictEqual(L.softParts('a'.repeat(45)), ['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(5)]);
    assert.deepStrictEqual(L.softParts(null), ['']);
    // Ett tecken som tar två platser i strängen delas inte på mitten.
    const faces = '😀'.repeat(21);
    assert.deepStrictEqual(L.softParts(faces), ['😀'.repeat(20), '😀']);
    assert.strictEqual(L.softParts(faces).join(''), faces);

    const long = 'W'.repeat(50);
    const flow = L.buildFlow({ name: 'Prov', prefix: 'L', devices: [long + '<b>', 'iPhone'], pair: [0, 1], apps: ['WhatsApp'], blocks: ['chat-text'] });
    const run = L.newRun(at(0), 'Europe/Stockholm');
    L.press(flow, run, at(5), 'klar');
    const p = L.protocol(flow, run, '');
    assert.ok(p.html.includes('W'.repeat(20) + '<wbr>' + 'W'.repeat(20) + '<wbr>' + 'W'.repeat(10) + '&lt;b&gt;'));
    assert.ok(!p.html.includes('W'.repeat(21)));
    assert.ok(p.text.includes(long + '<b>') && !p.text.includes('wbr'));
    assert.ok(L.checklist(flow).includes('W'.repeat(20) + '<wbr>'));
    assert.ok(!L.protocol(flowAB(), L.newRun(at(0), ''), '').html.includes('<wbr>'));
});
