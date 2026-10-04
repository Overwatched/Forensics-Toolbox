// Glue mellan sidan och den lokala krypto-/parser-motorn i lib/. All avkodning
// sker i KC-modulerna; den här filen sköter bara DOM, förlopp och presentation.
// Temat hanteras av det delade skalet (_shared/toolkit.js) — ingen tema-kod här.

const folderBtn = document.getElementById('folder-btn');
const folderInput = document.getElementById('folder-input');
const folderName = document.getElementById('folder-name');
const deviceInfo = document.getElementById('device-info');
const pwInput = document.getElementById('pw-input');
const pwToggle = document.getElementById('pw-toggle');
const runBtn = document.getElementById('run-btn');
const exportBtn = document.getElementById('export-btn');
const clearBtn = document.getElementById('clear-btn');
const progWrap = document.getElementById('progress-wrap');
const progBar = document.getElementById('progress-bar');
const progStatus = document.getElementById('progress-status');
const resultPanel = document.getElementById('result-panel');
const resultTitle = document.getElementById('result-title');
const resultBody = document.getElementById('result-body');
const kcToolbar = document.getElementById('kc-toolbar');
const kcSearch = document.getElementById('kc-search');
const kcTabs = document.getElementById('kc-tabs');
const kcList = document.getElementById('kc-list');
const out = document.getElementById('output');
const toast = document.getElementById('toast');

// ---- Tillstånd ------------------------------------------------------------
let fileMap = null;        // gemen relativ sökväg -> File
let manifestInfo = null;   // { deviceName, isEncrypted, ... }
let sqlPromise = null;
let lastResult = null;     // { General, Internet, Certs, Keys, ... }
let flatEntries = [];      // [{ cat, rec }]
let activeTab = 'all';
let toastTimer = null;

// ---- Småhjälpare ----------------------------------------------------------
function log(msg, cls) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg + '\n';
    out.appendChild(span);
    out.scrollTop = out.scrollHeight;
}

function clearLog() {
    out.textContent = '';
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function setProgress(text, indeterminate) {
    progWrap.classList.remove('display-none');
    progStatus.textContent = text || '';
    progBar.classList.toggle('indet', !!indeterminate);
}

function hideProgress() {
    progWrap.classList.add('display-none');
    progBar.classList.remove('indet');
}

function toHex(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
}

// Returnerar en sträng om byten ser ut som läsbar text, annars null.
function tryUtf8(u8) {
    if (!u8.length) return '';
    let printable = 0;
    for (let i = 0; i < u8.length; i++) {
        const c = u8[i];
        if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
    }
    if (printable / u8.length < 0.85) return null;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
        return null;
    }
}

function str(v) {
    if (typeof v === 'string') return v;
    if (v == null) return '';
    return typeof v === 'number' ? String(v) : '';
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ---- Mappval --------------------------------------------------------------
folderBtn.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', () => {
    const files = folderInput.files;
    if (!files || !files.length) return;
    fileMap = {};
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rel = f.webkitRelativePath || f.name;
        // Skala bort det första sökvägssegmentet (den valda mappens eget namn).
        const slash = rel.indexOf('/');
        const key = slash >= 0 ? rel.slice(slash + 1) : rel;
        fileMap[key.toLowerCase()] = f;
    }
    const rootName = (files[0].webkitRelativePath || '').split('/')[0] || 'mapp';
    folderName.textContent = `${rootName} (${files.length} filer)`;
    folderName.className = 'file-name set';
    inspectManifest();
});

function getFile(relpath) {
    if (!fileMap) return null;
    return fileMap[String(relpath).toLowerCase()] || null;
}

function getBytes(relpath) {
    const f = getFile(relpath);
    if (!f) return Promise.resolve(null);
    return f.arrayBuffer().then((ab) => new Uint8Array(ab));
}

// Titta på Manifest.plist för att visa enhetsnamn / krypteringsstatus.
function inspectManifest() {
    deviceInfo.classList.add('display-none');
    manifestInfo = null;
    getBytes('Manifest.plist').then((bytes) => {
        if (!bytes) {
            deviceInfo.innerHTML = '<span class="log-err">Ingen Manifest.plist i den här mappen. Välj den backup-mapp som direkt innehåller Manifest.plist och Manifest.db.</span>';
            deviceInfo.classList.remove('display-none');
            return;
        }
        try {
            manifestInfo = window.KC.backup.parseManifest(bytes);
        } catch (e) {
            deviceInfo.innerHTML = '<span class="log-err">Kunde inte läsa Manifest.plist: ' + esc(e.message) + '</span>';
            deviceInfo.classList.remove('display-none');
            return;
        }
        const enc = manifestInfo.isEncrypted;
        let html = '<span class="di-name">' + esc(manifestInfo.deviceName || 'iOS-enhet') + '</span>';
        if (manifestInfo.productVersion) html += ' <span class="log-muted">iOS ' + esc(manifestInfo.productVersion) + '</span>';
        html += '<span class="di-badge ' + (enc ? 'enc' : 'plain') + '">' + (enc ? 'Krypterad' : 'Okrypterad') + '</span>';
        if (!enc) html += '<div class="hint" style="margin-top:6px">iOS lagrar bara nyckelringen i krypterade backuper. Skapa om backupen med ”Kryptera lokal backup” aktiverat.</div>';
        deviceInfo.innerHTML = html;
        deviceInfo.classList.remove('display-none');
        if (enc) pwInput.focus();
    });
}

// ---- Visa/dölj lösenord ---------------------------------------------------
pwToggle.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    pwToggle.textContent = show ? 'Dölj' : 'Visa';
});
pwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runBtn.click();
});

// ---- sql.js ---------------------------------------------------------------
function ensureSQL() {
    if (sqlPromise) return sqlPromise;
    if (typeof initSqlJs !== 'function') return Promise.reject(new Error('sql.js kunde inte laddas.'));
    sqlPromise = initSqlJs({ wasmBinary: window.SQL_WASM_BINARY });
    return sqlPromise;
}

// ---- Kör ------------------------------------------------------------------
runBtn.addEventListener('click', () => {
    if (!fileMap) {
        showToast('Välj en backup-mapp först.');
        return;
    }
    runBtn.disabled = true;
    exportBtn.classList.add('display-none');
    resultPanel.classList.add('display-none');
    kcToolbar.classList.add('display-none');
    kcList.innerHTML = '';
    out.classList.remove('display-none'); // visa live-loggen under körning
    clearLog();
    setProgress('Startar…', true);
    log('Öppnar nyckelring…', 'log-muted');

    ensureSQL().then((SQL) => (
        window.KC.backup.loadKeychain({
            getBytes: getBytes,
            password: pwInput.value,
            SQL: SQL,
            onProgress: (m) => { setProgress(m, true); log(m, 'log-muted'); },
        })
    )).then((res) => {
        lastResult = res;
        hideProgress();
        renderResult(res);
        out.classList.add('display-none'); // dölj förloppsloggen när allt är klart
    }).catch((err) => {
        hideProgress();
        renderError(err);
        out.classList.remove('display-none'); // behåll loggen synlig vid fel
        log('Fel: ' + err.message, 'log-err');
    }).then(() => {
        runBtn.disabled = false;
    });
});

function renderError(err) {
    resultPanel.className = 'result-panel fail';
    resultTitle.textContent = err && err.needsPassword ? 'Lösenord krävs' : 'Kunde inte öppna nyckelringen';
    resultBody.innerHTML = esc(err ? err.message : 'Okänt fel');
    resultPanel.classList.remove('display-none');
}

// ---- Rendering av resultat ------------------------------------------------
const CATS = [
    { key: 'General', code: 'genp', label: 'Lösenord' },
    { key: 'Internet', code: 'inet', label: 'Internet' },
    { key: 'Certs', code: 'cert', label: 'Certifikat' },
    { key: 'Keys', code: 'keys', label: 'Nycklar' },
];

function renderResult(res) {
    flatEntries = [];
    CATS.forEach((c) => {
        (res[c.key] || []).forEach((rec) => flatEntries.push({ cat: c, rec: rec }));
    });

    resultPanel.className = 'result-panel success';
    resultTitle.textContent = 'Nyckelring öppnad — ' + (res.deviceName || 'iOS-enhet');
    let counts = '<div class="result-counts">';
    CATS.forEach((c) => {
        counts += '<span class="count-chip">' + c.label + ' <b>' + (res[c.key] || []).length + '</b></span>';
    });
    counts += '<span class="count-chip">Totalt <b>' + flatEntries.length + '</b></span></div>';
    resultBody.innerHTML = counts;
    resultPanel.classList.remove('display-none');
    exportBtn.classList.remove('display-none');

    // flikar
    activeTab = 'all';
    const tabs = [{ id: 'all', label: 'Alla', n: flatEntries.length }];
    CATS.forEach((c) => tabs.push({ id: c.code, label: c.label, n: (res[c.key] || []).length }));
    kcTabs.innerHTML = tabs.map((t) => (
        '<button class="kc-tab' + (t.id === 'all' ? ' active' : '') + '" data-tab="' + t.id + '">' +
        esc(t.label) + '<span class="kc-tab-n">' + t.n + '</span></button>'
    )).join('');
    kcSearch.value = '';
    kcToolbar.classList.remove('display-none');
    renderList();
}

kcTabs.addEventListener('click', (e) => {
    const b = e.target.closest('.kc-tab');
    if (!b) return;
    activeTab = b.getAttribute('data-tab');
    Array.prototype.forEach.call(kcTabs.children, (c) => c.classList.toggle('active', c === b));
    renderList();
});
kcSearch.addEventListener('input', () => renderList());

function entryTitle(cat, rec) {
    if (cat.code === 'inet') return str(rec.srvr) || str(rec.labl) || str(rec.acct) || '(internetlösenord)';
    // genp: inled med kontot; tjänsten / bundle-id:t blir undertext.
    if (cat.code === 'genp') return str(rec.acct) || str(rec.labl) || str(rec.svce) || '(generiskt lösenord)';
    if (cat.code === 'cert') return str(rec.labl) || str(rec.subj) || '(certifikat)';
    return str(rec.labl) || '(nyckel)';
}

function entrySub(cat, rec) {
    const bits = [];
    if (cat.code === 'genp') {
        if (str(rec.svce)) bits.push(str(rec.svce));
        if (str(rec.agrp) && str(rec.agrp) !== str(rec.svce)) bits.push(str(rec.agrp));
    } else if (cat.code === 'inet') {
        if (str(rec.acct)) bits.push(str(rec.acct));
        if (rec.ptcl != null) bits.push(str(rec.ptcl));
        if (rec.port) bits.push(':' + rec.port);
    } else if (str(rec.acct)) {
        bits.push(str(rec.acct));
    }
    return bits.join(' · ');
}

function filtered() {
    const q = kcSearch.value.trim().toLowerCase();
    return flatEntries.filter((e) => {
        if (activeTab !== 'all' && e.cat.code !== activeTab) return false;
        if (!q) return true;
        return searchBlob(e).indexOf(q) >= 0;
    });
}

function searchBlob(e) {
    if (e._blob) return e._blob;
    const parts = [e.cat.label];
    for (const k in e.rec) {
        if (!e.rec.hasOwnProperty(k) || k.charAt(0) === '_') continue;
        if (k === 'data') continue; // sök inte i hemligheter
        const v = e.rec[k];
        if (typeof v === 'string') parts.push(v);
        else if (typeof v === 'number') parts.push(String(v));
    }
    e._blob = parts.join(' ').toLowerCase();
    return e._blob;
}

function renderList() {
    const items = filtered();
    if (!items.length) {
        kcList.innerHTML = '<div class="kc-empty">Inga matchande poster.</div>';
        return;
    }
    let html = '';
    for (let i = 0; i < items.length; i++) {
        const e = items[i];
        const idx = flatEntries.indexOf(e);
        html += '<div class="kc-entry" data-idx="' + idx + '">' +
            '<div class="kc-entry-head">' +
            '<span class="kc-cat ' + e.cat.code + '">' + e.cat.code + '</span>' +
            '<span class="kc-main"><span class="kc-title">' + esc(entryTitle(e.cat, e.rec)) + '</span>' +
            '<span class="kc-sub">' + esc(entrySub(e.cat, e.rec)) + '</span></span>' +
            '<span class="kc-chev">▶</span>' +
            '</div>' +
            '<div class="kc-detail"></div>' +
            '</div>';
    }
    kcList.innerHTML = html;
}

// expandera / fäll ihop + lat rendering av detaljerna
kcList.addEventListener('click', (e) => {
    const mini = e.target.closest('.kc-mini');
    if (mini) {
        handleMini(mini);
        return;
    }
    const head = e.target.closest('.kc-entry-head');
    if (!head) return;
    const entry = head.parentNode;
    const open = entry.classList.toggle('open');
    if (open) {
        const detail = entry.querySelector('.kc-detail');
        if (!detail.getAttribute('data-filled')) {
            detail.innerHTML = renderDetail(flatEntries[+entry.getAttribute('data-idx')].rec);
            detail.setAttribute('data-filled', '1');
        }
    }
});

const FIELD_LABELS = {
    acct: 'Konto', svce: 'Tjänst', srvr: 'Server', labl: 'Etikett', desc: 'Beskrivning',
    agrp: 'Åtkomstgrupp', gena: 'Generisk', data: 'Hemlighet', ptcl: 'Protokoll', port: 'Port',
    path: 'Sökväg', atyp: 'Autentiseringstyp', sdmn: 'Säkerhetsdomän', pdmn: 'Skyddsklass',
    cdat: 'Skapad', mdat: 'Ändrad', sync: 'iCloud-synk', tomb: 'Gravsten',
    musr: 'Fleranvändare', sha1: 'SHA-1', subj: 'Subjekt', issr: 'Utfärdare', slnr: 'Serienr',
    skid: 'Subject key ID', type: 'Typ', bsiz: 'Nyckelstorlek', crtr: 'Skapare',
    cenc: 'Kan kryptera', esiz: 'Effektiv nyckelstorlek', klbl: 'Nyckeletikett', pcss: 'Beständig',
    vwht: 'Vyledtråd', accc: 'Åtkomstkontroll',
};
const FIELD_ORDER = ['data', 'acct', 'agrp', 'svce', 'srvr', 'ptcl', 'port', 'path', 'labl', 'desc', 'gena'];

function renderDetail(rec) {
    const keys = Object.keys(rec).filter((k) => k.charAt(0) !== '_');
    keys.sort((a, b) => {
        let ia = FIELD_ORDER.indexOf(a);
        let ib = FIELD_ORDER.indexOf(b);
        if (ia < 0) ia = 99;
        if (ib < 0) ib = 99;
        if (ia !== ib) return ia - ib;
        return a < b ? -1 : 1;
    });
    if (rec.__error) {
        return '<div class="kc-field"><div class="kc-field-k">Status</div><div class="kc-field-v"><span class="kc-vtext log-err">' + esc(rec.__error) + '</span></div></div>';
    }
    let html = '';
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const label = FIELD_LABELS[k] || k;
        const codeTag = FIELD_LABELS[k] ? ' <span class="kc-code">' + esc(k) + '</span>' : '';
        html += '<div class="kc-field"><div class="kc-field-k">' + esc(label) + codeTag + '</div>' +
            '<div class="kc-field-v' + (k === 'data' ? ' kc-secret' : '') + '">' + renderValue(k, rec[k]) + '</div></div>';
    }
    return html;
}

function renderValue(key, v) {
    if (v == null) return '<span class="kc-vtext log-muted">(null)</span>';
    if (typeof v === 'boolean') return '<span class="kc-vtext">' + (v ? 'Ja' : 'Nej') + '</span>';
    if (typeof v === 'number') return '<span class="kc-vtext">' + esc(String(v)) + '</span>';
    if (typeof v === 'string') return '<span class="kc-vtext">' + esc(v) + '</span>' + copyBtn(v);
    if (v && v.__asn1time) return '<span class="kc-vtext">' + esc(fmtAsn1Time(v.__asn1time)) + '</span>';
    if (v && typeof v.__nsdate === 'number') return '<span class="kc-vtext">' + esc(fmtNsDate(v.__nsdate)) + '</span>';
    if (v instanceof Uint8Array) {
        const hex = toHex(v);
        const text = tryUtf8(v);
        if (key === 'data') {
            // maskerad som standard
            const payload = text != null ? text : hex;
            return '<span class="kc-vtext" data-secret="' + esc(payload) + '" data-mode="' + (text != null ? 'text' : 'hex') + '">••••••••</span>' +
                '<button class="kc-mini" data-act="reveal">Visa</button>' +
                '<button class="kc-mini" data-act="copy" data-copy="' + esc(payload) + '">Kopiera</button>';
        }
        if (text != null) {
            return '<span class="kc-vtext">' + esc(text) + '</span>' + copyBtn(text) +
                '<button class="kc-mini" data-act="togglehex" data-hex="' + esc(hex) + '" data-text="' + esc(text) + '">Hex</button>';
        }
        return '<span class="kc-vtext kc-hex">' + esc(hex) + '</span>' + copyBtn(hex);
    }
    if (Array.isArray(v)) return '<span class="kc-vtext log-muted">[' + v.length + ' objekt]</span>';
    return '<span class="kc-vtext log-muted">' + esc(String(v)) + '</span>';
}

function copyBtn(val) {
    return '<button class="kc-mini" data-act="copy" data-copy="' + esc(val) + '">Kopiera</button>';
}

function handleMini(btn) {
    const act = btn.getAttribute('data-act');
    const vtext = btn.parentNode.querySelector('.kc-vtext');
    if (act === 'copy') {
        copyText(btn.getAttribute('data-copy'));
    } else if (act === 'reveal') {
        if (vtext.getAttribute('data-revealed')) {
            vtext.textContent = '••••••••';
            vtext.removeAttribute('data-revealed');
            btn.textContent = 'Visa';
        } else {
            vtext.textContent = vtext.getAttribute('data-secret');
            vtext.setAttribute('data-revealed', '1');
            btn.textContent = 'Dölj';
        }
    } else if (act === 'togglehex') {
        if (vtext.getAttribute('data-ishex')) {
            vtext.textContent = btn.getAttribute('data-text');
            vtext.classList.remove('kc-hex');
            vtext.removeAttribute('data-ishex');
            btn.textContent = 'Hex';
        } else {
            vtext.textContent = btn.getAttribute('data-hex');
            vtext.classList.add('kc-hex');
            vtext.setAttribute('data-ishex', '1');
            btn.textContent = 'Text';
        }
    }
}

function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(() => showToast('Kopierat'), () => legacyCopy(t));
    } else {
        legacyCopy(t);
    }
}

function legacyCopy(t) {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast('Kopierat');
    } catch (e) {
        /* kunde inte kopiera */
    }
    document.body.removeChild(ta);
}

// ---- Export ---------------------------------------------------------------
exportBtn.addEventListener('click', () => {
    if (!lastResult) return;
    const dump = { device: lastResult.deviceName, iosVersion: lastResult.productVersion, categories: {} };
    CATS.forEach((c) => {
        dump.categories[c.label] = (lastResult[c.key] || []).map(serializeRec);
    });
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keychain-' + (lastResult.deviceName || 'ios').replace(/[^\w.-]+/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Exporterade JSON');
});

function serializeRec(rec) {
    const o = {};
    for (const k in rec) {
        if (!rec.hasOwnProperty(k) || k.charAt(0) === '_') continue;
        o[k] = serializeVal(rec[k]);
    }
    if (rec.__error) o._error = rec.__error;
    return o;
}

function serializeVal(v) {
    if (v instanceof Uint8Array) {
        const t = tryUtf8(v);
        return t != null ? t : { hex: toHex(v) };
    }
    if (v && v.__asn1time) return fmtAsn1Time(v.__asn1time);
    if (v && typeof v.__nsdate === 'number') return fmtNsDate(v.__nsdate);
    if (Array.isArray(v)) return v.map(serializeVal);
    return v;
}

// ---- Datum / övrigt -------------------------------------------------------
function fmtAsn1Time(s) {
    // UTCTime YYMMDDHHMMSSZ eller GeneralizedTime YYYYMMDDHHMMSSZ
    const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?/.exec(s);
    if (!m) return s;
    const yr = m[1].length === 2 ? (parseInt(m[1], 10) >= 50 ? '19' + m[1] : '20' + m[1]) : m[1];
    return yr + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + ' UTC';
}

function fmtNsDate(sec) {
    try {
        return new Date(sec * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    } catch (e) {
        return String(sec);
    }
}

// ---- Rensa ----------------------------------------------------------------
clearBtn.addEventListener('click', () => {
    lastResult = null;
    flatEntries = [];
    kcList.innerHTML = '';
    kcToolbar.classList.add('display-none');
    resultPanel.classList.add('display-none');
    exportBtn.classList.add('display-none');
    hideProgress();
    out.classList.remove('display-none');
    out.textContent = 'Väntar på körning…';
    pwInput.value = '';
});
