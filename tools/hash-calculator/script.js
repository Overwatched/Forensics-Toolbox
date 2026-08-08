const textInput = document.getElementById('text-input');
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const toast = document.getElementById('toast');

let mode = 'text';
let selectedFile = null;

function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--error)' : 'var(--text-muted)';
}

function showToast() {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1400);
}

async function digest(algo, buffer) {
    const hash = await crypto.subtle.digest(algo, buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// MD5 via SubtleCrypto saknas i många miljöer — använd en liten ren JS-implementation.
function md5(buffer) {
    // Minimal MD5 (RFC 1321) för ArrayBuffer/Uint8Array
    function cmn(q, a, b, x, s, t) {
        a = (a + q + x + t) | 0;
        return (((a << s) | (a >>> (32 - s))) + b) | 0;
    }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    const nBlocks = (((len + 8) >>> 6) + 1) * 16;
    const words = new Array(nBlocks).fill(0);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[len >> 2] |= 0x80 << ((len % 4) * 8);
    words[nBlocks - 2] = len * 8;

    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < nBlocks; i += 16) {
        const oa = a, ob = b, oc = c, od = d;
        a = ff(a, b, c, d, words[i], 7, -680876936);
        d = ff(d, a, b, c, words[i + 1], 12, -389564586);
        c = ff(c, d, a, b, words[i + 2], 17, 606105819);
        b = ff(b, c, d, a, words[i + 3], 22, -1044525330);
        a = ff(a, b, c, d, words[i + 4], 7, -176418897);
        d = ff(d, a, b, c, words[i + 5], 12, 1200080426);
        c = ff(c, d, a, b, words[i + 6], 17, -1473231341);
        b = ff(b, c, d, a, words[i + 7], 22, -45705983);
        a = ff(a, b, c, d, words[i + 8], 7, 1770035416);
        d = ff(d, a, b, c, words[i + 9], 12, -1958414417);
        c = ff(c, d, a, b, words[i + 10], 17, -42063);
        b = ff(b, c, d, a, words[i + 11], 22, -1990404162);
        a = ff(a, b, c, d, words[i + 12], 7, 1804603682);
        d = ff(d, a, b, c, words[i + 13], 12, -40341101);
        c = ff(c, d, a, b, words[i + 14], 17, -1502002290);
        b = ff(b, c, d, a, words[i + 15], 22, 1236535329);
        a = gg(a, b, c, d, words[i + 1], 5, -165796510);
        d = gg(d, a, b, c, words[i + 6], 9, -1069501632);
        c = gg(c, d, a, b, words[i + 11], 14, 643717713);
        b = gg(b, c, d, a, words[i], 20, -373897302);
        a = gg(a, b, c, d, words[i + 5], 5, -701558691);
        d = gg(d, a, b, c, words[i + 10], 9, 38016083);
        c = gg(c, d, a, b, words[i + 15], 14, -660478335);
        b = gg(b, c, d, a, words[i + 4], 20, -405537848);
        a = gg(a, b, c, d, words[i + 9], 5, 568446438);
        d = gg(d, a, b, c, words[i + 14], 9, -1019803690);
        c = gg(c, d, a, b, words[i + 3], 14, -187363961);
        b = gg(b, c, d, a, words[i + 8], 20, 1163531501);
        a = gg(a, b, c, d, words[i + 13], 5, -1444681467);
        d = gg(d, a, b, c, words[i + 2], 9, -51403784);
        c = gg(c, d, a, b, words[i + 7], 14, 1735328473);
        b = gg(b, c, d, a, words[i + 12], 20, -1926607734);
        a = hh(a, b, c, d, words[i + 5], 4, -378558);
        d = hh(d, a, b, c, words[i + 8], 11, -2022574463);
        c = hh(c, d, a, b, words[i + 11], 16, 1839030562);
        b = hh(b, c, d, a, words[i + 14], 23, -35309556);
        a = hh(a, b, c, d, words[i + 1], 4, -1530992060);
        d = hh(d, a, b, c, words[i + 4], 11, 1272893353);
        c = hh(c, d, a, b, words[i + 7], 16, -155497632);
        b = hh(b, c, d, a, words[i + 10], 23, -1094730640);
        a = hh(a, b, c, d, words[i + 13], 4, 681279174);
        d = hh(d, a, b, c, words[i], 11, -358537222);
        c = hh(c, d, a, b, words[i + 3], 16, -722521979);
        b = hh(b, c, d, a, words[i + 6], 23, 76029189);
        a = hh(a, b, c, d, words[i + 9], 4, -640364487);
        d = hh(d, a, b, c, words[i + 12], 11, -421815835);
        c = hh(c, d, a, b, words[i + 15], 16, 530742520);
        b = hh(b, c, d, a, words[i + 2], 23, -995338651);
        a = ii(a, b, c, d, words[i], 6, -198630844);
        d = ii(d, a, b, c, words[i + 7], 10, 1126891415);
        c = ii(c, d, a, b, words[i + 14], 15, -1416354905);
        b = ii(b, c, d, a, words[i + 5], 21, -57434055);
        a = ii(a, b, c, d, words[i + 12], 6, 1700485571);
        d = ii(d, a, b, c, words[i + 3], 10, -1894986606);
        c = ii(c, d, a, b, words[i + 10], 15, -1051523);
        b = ii(b, c, d, a, words[i + 1], 21, -2054922799);
        a = ii(a, b, c, d, words[i + 8], 6, 1873313359);
        d = ii(d, a, b, c, words[i + 15], 10, -30611744);
        c = ii(c, d, a, b, words[i + 6], 15, -1560198380);
        b = ii(b, c, d, a, words[i + 13], 21, 1309151649);
        a = ii(a, b, c, d, words[i + 4], 6, -145523070);
        d = ii(d, a, b, c, words[i + 11], 10, -1120210379);
        c = ii(c, d, a, b, words[i + 2], 15, 718787259);
        b = ii(b, c, d, a, words[i + 9], 21, -343485551);
        a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
    }

    function hex(n) {
        let s = '';
        for (let i = 0; i < 4; i++) s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
        return s;
    }
    return hex(a) + hex(b) + hex(c) + hex(d);
}

async function hashBuffer(buffer) {
    const [sha1, sha256] = await Promise.all([
        digest('SHA-1', buffer),
        digest('SHA-256', buffer),
    ]);
    return { md5: md5(buffer), sha1, sha256 };
}

function renderHashes(hashes) {
    document.getElementById('md5-out').textContent = hashes.md5;
    document.getElementById('sha1-out').textContent = hashes.sha1;
    document.getElementById('sha256-out').textContent = hashes.sha256;
    results.classList.remove('display-none');
}

document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        mode = tab.dataset.mode;
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('text-panel').classList.toggle('display-none', mode !== 'text');
        document.getElementById('file-panel').classList.toggle('display-none', mode !== 'file');
    });
});

fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files[0] || null;
    fileLabel.textContent = selectedFile ? selectedFile.name : 'Välj en fil eller dra hit';
});

document.getElementById('hash-button').addEventListener('click', async () => {
    try {
        let buffer;
        if (mode === 'text') {
            const text = textInput.value;
            if (!text) {
                setStatus('Klistra in text först', true);
                return;
            }
            buffer = new TextEncoder().encode(text);
            setStatus(`${text.length} tecken`);
        } else {
            if (!selectedFile) {
                setStatus('Välj en fil först', true);
                return;
            }
            buffer = await selectedFile.arrayBuffer();
            setStatus(`${selectedFile.name} (${selectedFile.size} bytes)`);
        }
        renderHashes(await hashBuffer(buffer));
    } catch (err) {
        setStatus('Kunde inte beräkna hash', true);
        console.error(err);
    }
});

document.getElementById('clear-button').addEventListener('click', () => {
    textInput.value = '';
    fileInput.value = '';
    selectedFile = null;
    fileLabel.textContent = 'Välj en fil eller dra hit';
    results.classList.add('display-none');
    setStatus('Ingen data laddad');
});

document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const value = document.getElementById(btn.dataset.target).textContent;
        try {
            await navigator.clipboard.writeText(value);
            showToast();
        } catch (e) {
            setStatus('Kunde inte kopiera', true);
        }
    });
});

window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (data && (data.source === 'forensics-toolbox' || data.source === 'verktygslada') &&
        data.type === 'theme' && (data.theme === 'light' || data.theme === 'dark')) {
        document.documentElement.setAttribute('data-theme', data.theme);
        try { localStorage.setItem('theme', data.theme); } catch (e) { /* ignoreras */ }
    }
});
