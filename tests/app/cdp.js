// En liten klient för DevTools-protokollet, för provkörningarna av appen. Verktygen är iframes i
// Toolbox.html: varje ram har en egen exekveringskontext, och filväljare sätts med DOM-domänen.
// Fel och undantag i sidan samlas i errors, så att en provkörning kan säga till om dem.
'use strict';

const fs = require('node:fs');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect(port, opts) {
    opts = opts || {};
    let list = null;
    for (let i = 0; i < 120 && !(list && list.some((t) => t.type === 'page')); i++) {
        try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { /* inte uppe än */ }
        if (!(list && list.some((t) => t.type === 'page'))) await sleep(250);
    }
    const page = list && list.find((t) => t.type === 'page');
    if (!page) throw new Error('Appen svarar inte på port ' + port);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = {};
    const contexts = [];
    const errors = [];
    ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
        if (d.method === 'Runtime.executionContextCreated') contexts.push(d.params.context);
        if (d.method === 'Runtime.executionContextDestroyed') {
            const i = contexts.findIndex((c) => c.id === d.params.executionContextId);
            if (i >= 0) contexts.splice(i, 1);
        }
        if (d.method === 'Runtime.executionContextsCleared') contexts.length = 0;
        if (d.method === 'Runtime.exceptionThrown') {
            const x = d.params.exceptionDetails;
            errors.push({ kind: 'exception', text: (x.exception && x.exception.description) || x.text, url: x.url || '' });
        }
        if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
            errors.push({ kind: 'console.error', text: d.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' ') });
        }
        if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
            errors.push({ kind: 'log', text: d.params.entry.text, url: d.params.entry.url || '' });
        }
    };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const send = (method, params) => new Promise((resolve) => {
        const i = ++id;
        pending[i] = resolve;
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('DOM.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: opts.width || 1600, height: opts.height || 1000, deviceScaleFactor: 1, mobile: false });
    // Runtime.enable spelar upp gamla meddelanden: de räknas inte.
    await sleep(200);
    errors.length = 0;

    async function frames() {
        const tree = await send('Page.getFrameTree');
        const out = [];
        (function walk(n) { out.push(n.frame); (n.childFrames || []).forEach(walk); })(tree.result.frameTree);
        return out;
    }

    function contextOf(frameId) {
        const c = contexts.filter((x) => x.auxData && x.auxData.frameId === frameId && x.auxData.isDefault).pop();
        return c ? c.id : null;
    }

    // Huvudfönstret eller ramen vars adress innehåller part.
    async function ctx(part) {
        for (let i = 0; i < 80; i++) {
            const all = await frames();
            const f = part ? all.find((x) => x.parentId && x.url.includes(part)) : all.find((x) => !x.parentId);
            const c = f && contextOf(f.id);
            if (c) return c;
            await sleep(250);
        }
        throw new Error('Hittar ingen ram för ' + (part || 'huvudfönstret'));
    }

    async function ev(part, expr) {
        const r = await send('Runtime.evaluate', { expression: expr, contextId: await ctx(part), awaitPromise: true, returnByValue: true });
        if (r.result.exceptionDetails) throw new Error('I sidan: ' + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
        return r.result.result.value;
    }

    async function waitFor(part, expr, ms, label) {
        const t0 = Date.now();
        let last = null;
        while (Date.now() - t0 < (ms || 30000)) {
            try { last = await ev(part, expr); } catch (e) { last = null; }
            if (last) return last;
            await sleep(200);
        }
        throw new Error('Tidsgränsen gick ut: ' + (label || expr));
    }

    // Verktyget i sidopanelen med den rubriken.
    async function nav(title) {
        const r = await ev(null, `(function(){const el=[...document.querySelectorAll('.nav-item')].find(e=>(e.querySelector('.nav-item-title')||e).textContent.trim()===${JSON.stringify(title)}); if(!el) return false; el.click(); return true;})()`);
        if (!r) throw new Error('Inget verktyg heter ' + title);
    }

    // Filer till en filväljare i huvudfönstret (part null) eller i en ram. Sökvägarna ska vara absoluta.
    async function setFiles(part, selector, files) {
        let root;
        if (!part) {
            root = (await send('DOM.getDocument', { depth: 1 })).result.root.nodeId;
        } else {
            const f = (await frames()).find((x) => x.parentId && x.url.includes(part));
            if (!f) throw new Error('Hittar ingen ram för ' + part);
            await send('DOM.getDocument', { depth: -1, pierce: true });
            const owner = await send('DOM.getFrameOwner', { frameId: f.id });
            const desc = await send('DOM.describeNode', { nodeId: owner.result.nodeId, depth: 1, pierce: true });
            const doc = desc.result.node.contentDocument;
            if (!doc) throw new Error('Ramen ' + part + ' har inget dokument');
            root = doc.nodeId;
        }
        const q = await send('DOM.querySelector', { nodeId: root, selector });
        if (!q.result || !q.result.nodeId) throw new Error('Hittar inte ' + selector);
        const r = await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files });
        if (r.error) throw new Error('setFileInputFiles: ' + JSON.stringify(r.error));
    }

    async function shot(file) {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
    }

    return { send, frames, ctx, ev, waitFor, nav, setFiles, shot, errors, close: () => ws.close() };
}

module.exports = { connect, sleep };
