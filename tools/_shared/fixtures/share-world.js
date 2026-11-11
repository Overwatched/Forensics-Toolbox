// Ett huvudfönster och verktyg i var sin ram till testerna av delningen (db-share.js), utan webbläsare.
'use strict';

const share = require('../db-share');

// En klocka som testet vrider fram.
function fakeClock() {
    let now = 0;
    let timers = [];
    return {
        later(fn, ms) {
            const t = { at: now + ms, fn };
            timers.push(t);
            return () => { timers = timers.filter((x) => x !== t); };
        },
        advance(ms) {
            now += ms;
            for (;;) {
                const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
                if (!due) return;
                timers = timers.filter((x) => x !== due);
                due.fn();
            }
        },
        pending: () => timers.length,
    };
}

// Svaga referenser som testet kan släppa, som när databasen har stängts och minnet lämnats tillbaka.
function looseRefs() {
    const all = [];
    class Ref {
        constructor(value) { this.value = value; all.push(this); }
        deref() { return this.value; }
    }
    return { WeakRef: Ref, drop: () => all.forEach((r) => { r.value = undefined; }) };
}

// Ett huvudfönster och verktyg i var sin ram. Meddelandena går som i webbläsaren: i tur och ordning, efter
// den som skickade, och det som överlåts försvinner hos avsändaren.
function world() {
    const clock = fakeClock();
    const queue = [];
    const reg = share.registry({
        send: (frame, payload, transfer) => {
            // frame.refuses(payload): meddelandet går inte att skicka, som när postMessage kastar.
            if (frame.refuses && frame.refuses(payload)) throw new Error('kunde inte skickas');
            const m = structuredClone(payload, { transfer: transfer || [] });
            queue.push(() => frame.receive(m));
        },
        name: (frame) => frame.title,
        later: clock.later,
    });
    function tool(title, opts) {
        const frame = { title, handlers: [], sent: [], posts: [], got: [], online: true, deaf: false };
        frame.receive = (m) => { frame.got.push(m.type); frame.handlers.forEach((fn) => fn(m)); };
        frame.client = share.createClient({
            hub: () => frame.online,
            post: (payload, transfer) => {
                frame.sent.push(payload.type);
                const m = structuredClone(payload, { transfer: transfer || [] });
                frame.posts.push(m);
                if (!frame.deaf) queue.push(() => reg.handle(frame, m));
            },
            listen: (fn) => frame.handlers.push(fn),
        }, Object.assign({ later: clock.later }, opts));
        return frame;
    }
    // Kör tills inget meddelande och inget löfte väntar.
    async function settle() {
        for (let quiet = 0; quiet < 3;) {
            if (queue.length) { queue.shift()(); quiet = 0; } else quiet++;
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
    // Kör meddelandena tills löftet är klart, för arbete som väntar på svar under tiden (en inläsning).
    async function until(promise) {
        let done = false;
        const end = () => { done = true; };
        promise.then(end, end);
        while (!done) await settle();
        return promise;
    }
    return { clock, reg, tool, settle, until };
}

module.exports = { world, fakeClock, looseRefs };
