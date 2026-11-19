'use strict';
// Chattar: kontrasten i bubblorna, läst ur style.css. För varje app och läge ska bubblans text, tiden i foten,
// systemraden, avsändarens namn och initialen i ringen gå att läsa (minst 4,5:1, WCAG AA för vanlig text).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const APPS = ['', 'WhatsApp', 'Signal', 'Telegram', 'Snapchat'];

function vars(selector) {
    const at = CSS.indexOf(selector + ' {');
    if (at < 0) return {};
    const body = CSS.slice(at + selector.length + 2, CSS.indexOf('}', at));
    const out = {};
    for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
    return out;
}
function palette(app, theme) {
    const base = Object.assign({}, vars(':root'), theme === 'light' ? vars('[data-theme="light"]') : {});
    if (!app) return base;
    const own = '.c-msgs[data-app="' + app + '"]';
    const p = Object.assign(base, vars(own), theme === 'light' ? vars('[data-theme="light"] ' + own) : {});
    assert.ok(p['bubble-me'] && p['bubble-them-text'], 'Färgerna för ' + app + ' i ' + theme + ' saknas i style.css');
    return p;
}
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (c) => { const f = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));

test('bubblorna går att läsa i varje app, i ljust och mörkt läge', () => {
    const foot = Number((/\.foot \{[^}]*opacity: ([\d.]+)/.exec(CSS) || [])[1]);
    assert.ok(foot > 0 && foot <= 1, 'Fotens opacitet');
    const low = [];
    for (const theme of ['dark', 'light']) {
        for (const app of APPS) {
            const p = palette(app, theme), name = (app || 'övriga') + ' ' + theme;
            const check = (what, fg, bg, min) => { const r = ratio(fg, bg); if (r < (min || 4.5)) low.push(name + ' ' + what + ' ' + r.toFixed(2)); };
            for (const side of ['them', 'me']) {
                const bg = rgb(p['bubble-' + side]), fg = rgb(p['bubble-' + side + '-text']);
                check(side + ': text', fg, bg);
                check(side + ': tiden', mix(fg, bg, foot), bg);
            }
            check('systemrad', rgb(p['bubble-sys-text']), rgb(p['bubble-sys']));
            for (let i = 0; i < 8; i++) {
                check('namnet p' + i, rgb(p['p' + i]), rgb(p['bubble-them']));
                check('initialen p' + i, rgb(p['on-p']), rgb(p['p' + i]));
            }
        }
    }
    assert.deepStrictEqual(low, []);
});

test('varningen under en bilaga har egna färger som går att läsa', () => {
    const m = /\.att-check\.bad \{[^}]*color: (#[0-9a-f]{6});[^}]*background: (#[0-9a-f]{6})/.exec(CSS);
    assert.ok(m && ratio(rgb(m[1]), rgb(m[2])) >= 4.5, 'Varningen: ' + (m && m.slice(1)));
});
