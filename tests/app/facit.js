// Facit-testerna: Härkomst bedömer filerna i labbzippen, och tiderna jämförs med det som loggades
// på labbtelefonen (facit/lab-android-nord.json). Ett fel här betyder att programmets underlag inte
// stämmer med verkligheten, inte bara att utskriften ändrats. Körs bara när labbzippen finns.
'use strict';

const facit = require('./facit/lab-android-nord.json');
const { sleep } = require('./cdp');
const { expect, PROV } = require('./smoke');

const ms = (iso) => Date.parse(iso);
const iso = (t) => t == null ? 'saknas' : new Date(t).toISOString();

// Bedömer filen och läser det facit jämförs med ur modellen.
async function assess(c, name) {
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && (!document.getElementById('result').classList.contains('display-none') || !document.getElementById('hits').classList.contains('display-none') || /warn|err/.test(document.getElementById('run-status').innerHTML))`, 120000, name);
    const list = await c.ev(PROV, `!document.getElementById('hits').classList.contains('display-none') && document.querySelectorAll('#hits tr.pick').length`);
    if (list) throw new Error(name + ' gav en vallista med ' + list + ' rader');
    return c.ev(PROV, `(function(){
        const m = ProvenanceApp.model();
        if (!m || m.file.filename !== ${JSON.stringify(name)}) return { error: document.getElementById('run-status').innerText };
        return {
            T: m.file.createdMs, type: m.type.type, versions: ProvenanceApp.meta().appVersionsText || '',
            memory: m.file.memory ? { capturedMs: m.file.memory.capturedMs, front: m.file.memory.front } : null,
            snap: m.file.snapchatCache ? { messageMs: m.file.snapchatCache.messageCreatedMs || null, own: m.file.snapchatCache.own } : null,
            factors: Object.fromEntries(m.factors.map(f => [f.id, f.state])),
            windows: m.windows.map(w => ({ id: w.id, label: w.label, centerMs: w.centerMs, startMs: w.startMs, endMs: w.endMs })),
            events: m.events.filter(e => ['app', 'screen', 'lock', 'sig-message'].includes(e.kind)).map(e => ({
                kind: e.kind, app: e.app || null, stream: e.stream || null, cameraOp: !!e.cameraOp, on: e.on, locked: e.locked,
                ms: e.ms, endMs: e.endMs == null ? null : e.endMs, isFile: !!e.isFile, own: !!e.own, deleted: !!e.deleted })),
        };
    })()`);
}

function near(actual, want, tol, what) {
    expect(actual != null && Math.abs(actual - ms(want)) <= tol, what + ': ' + iso(actual) + ', facit ' + want);
}

function covering(events, pred, at) {
    return events.filter((e) => pred(e) && e.ms <= at && (e.endMs == null ? e.ms : e.endMs) >= at);
}

function check(f, d) {
    const tol = f.toleranceMs || facit.toleranceMs;
    expect(!d.error, f.name + ': ' + d.error);
    if (f.T) near(d.T, f.T, tol, 'T');
    if (f.captured) {
        expect(d.memory, 'Ingen koppling till Memories');
        near(d.memory.capturedMs, f.captured, tol, 'Tagen enligt Memories');
    }
    if (f.front != null) expect(d.memory && d.memory.front === f.front, 'Kameran: ' + (d.memory && d.memory.front ? 'fram' : 'bak') + ', facit ' + (f.front ? 'fram' : 'bak'));
    const T = d.T;
    if (f.foreground) {
        const fg = covering(d.events, (e) => e.kind === 'app' && !e.cameraOp && e.app === f.foreground.app, T);
        expect(fg.length, f.foreground.app + ' i förgrunden vid T saknas');
        if (f.foreground.from) near(fg[0].ms, f.foreground.from, tol, 'Förgrunden börjar');
        if (f.foreground.to) near(fg[0].endMs, f.foreground.to, tol, 'Förgrunden slutar');
    }
    if (f.screenOn) {
        const on = covering(d.events, (e) => e.kind === 'screen' && e.on === true, T);
        expect(on.length, 'Skärmen tänd vid T saknas');
        near(on[0].ms, f.screenOn.from, tol, 'Skärmen tänds');
        near(on[0].endMs, f.screenOn.to, tol, 'Skärmen släcks');
    }
    if (f.unlocked) {
        const un = covering(d.events, (e) => e.kind === 'lock' && e.locked === false, T);
        expect(un.length, 'Olåst vid T saknas');
        near(un[0].ms, f.unlocked.from, tol, 'Upplåst');
    }
    if (f.cameraAt) {
        const at = ms(f.cameraAt.at);
        const cam = covering(d.events, (e) => e.kind === 'app' && e.cameraOp && e.app === f.cameraAt.app, at);
        expect(cam.length, f.cameraAt.app + ' använder inte kameran ' + f.cameraAt.at + ' enligt programmet');
        if (f.cameraAt.until) expect(cam[0].endMs >= ms(f.cameraAt.until) - tol, 'Kameran slutar ' + iso(cam[0].endMs) + ', före ' + f.cameraAt.until);
    }
    if (f.message) {
        expect(d.snap, 'Ingen koppling till Snapchats register');
        near(d.snap.messageMs, f.message, tol, 'Meddelandet');
        expect(d.snap.own === f.own, 'Avsändaren: ' + (d.snap.own ? 'eget konto' : 'annat konto'));
    }
    if (f.signal) {
        const mine = d.events.filter((e) => e.kind === 'sig-message' && e.isFile);
        (f.signal.received || []).forEach((t) => expect(mine.some((e) => !e.own && Math.abs(e.ms - ms(t)) <= tol), 'Mottagen i Signal ' + t + ' saknas: ' + mine.map((e) => iso(e.ms)).join(', ')));
        (f.signal.sent || []).forEach((t) => expect(mine.some((e) => e.own && Math.abs(e.ms - ms(t)) <= tol), 'Skickad i Signal ' + t + ' saknas: ' + mine.map((e) => iso(e.ms)).join(', ')));
        if (f.signal.deletedLast) {
            const last = mine.filter((e) => e.own).sort((a, b) => a.ms - b.ms).pop();
            expect(last && last.deleted, 'Det sista meddelandet är inte märkt som raderat');
        }
    }
    if (f.signalWindow) {
        // Fönstret kring sändningen i Signal ska ha loggarna (rättat i 1.40).
        const w = d.windows.find((x) => /Signal/.test(x.label));
        expect(w, 'Inget fönster kring Signal');
        near(w.centerMs, f.signalWindow.center, 2000, 'Signal-fönstret');
        const screen = d.events.filter((e) => e.kind === 'screen' && e.ms <= w.endMs && (e.endMs == null ? e.ms : e.endMs) >= w.startMs);
        expect(screen.length, 'Signal-fönstret har ingen skärmlogg');
    }
    (f.versions || []).forEach((v) => expect(d.versions.includes(v), 'Appversionen ' + v + ' saknas i protokollet: ' + d.versions));
    Object.keys(f.factors || {}).forEach((id) => expect(d.factors[id] === f.factors[id], 'Faktorn ' + id + ' är ' + d.factors[id] + ', väntat ' + f.factors[id]));
    return 'T ' + (d.T ? iso(d.T).slice(11, 23) + 'Z' : '–');
}

function scenarios(zip) {
    const open = ['Labbzippen öppnas i Härkomst', async ({ c }) => {
        const fs = require('node:fs');
        const before = fs.statSync(zip);
        await c.nav('Härkomst');
        await c.setFiles(null, '#cb-input', [zip]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(require('node:path').basename(zip))})`, 120000, 'labbzippen');
        scenarios.before = before;
        return require('node:path').basename(zip);
    }];
    const files = facit.files.map((f) => [f.name + ': ' + f.what, async ({ c }) => check(f, await assess(c, f.name))]);
    const untouched = ['Labbzippen är orörd', async () => {
        const after = require('node:fs').statSync(zip);
        const b = scenarios.before;
        expect(b && b.size === after.size && b.mtimeMs === after.mtimeMs && b.ctimeMs === after.ctimeMs, 'Storlek, mtime eller ctime har ändrats');
        return 'storlek, mtime och ctime';
    }];
    return [open].concat(files, [untouched]);
}

module.exports = { scenarios };
