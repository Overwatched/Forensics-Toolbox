const bandSelect = document.getElementById('band-select');
const querySelect = document.getElementById('query-select');
const bandNotes = document.getElementById('band-notes');
const paramsEl = document.getElementById('params');
const caveatsEl = document.getElementById('caveats');
const sqlOut = document.getElementById('sql-out');
const metaBox = document.getElementById('meta-box');
const loadError = document.getElementById('load-error');
const generateButton = document.getElementById('generate-button');
const copyButton = document.getElementById('copy-button');
const toast = document.getElementById('toast');

let catalog = null;

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showToast() {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1200);
}

function currentBand() {
    return catalog.bands.find((b) => b.id === bandSelect.value) || catalog.bands[0];
}

function currentQuery() {
    const band = currentBand();
    return (band.queries || []).find((q) => q.id === querySelect.value) || band.queries[0];
}

function fillQueries() {
    const band = currentBand();
    querySelect.innerHTML = (band.queries || []).map((q) =>
        `<option value="${escapeHtml(q.id)}">${escapeHtml(q.title)}</option>`
    ).join('');

    if (band.notes) {
        bandNotes.textContent = band.notes;
        bandNotes.classList.remove('display-none');
    } else {
        bandNotes.classList.add('display-none');
    }

    renderParams();
    generateSql();
}

function renderParams() {
    const q = currentQuery();
    const labels = catalog.paramLabels || {};
    const params = q.params || [];

    if (!params.length) {
        paramsEl.innerHTML = '';
        return;
    }

    paramsEl.innerHTML = params.map((name) => `
      <div class="param-block">
        <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(labels[name] || name)}</label>
        <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}" spellcheck="false" autocomplete="off">
      </div>
    `).join('');

    paramsEl.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', generateSql);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') generateSql();
        });
    });
}

function applyParams(sql, params) {
    let out = sql;
    for (const name of params || []) {
        const el = document.getElementById('param-' + name);
        let value = el ? el.value.trim() : '';
        // Escape single quotes for SQL string literals
        value = value.replace(/'/g, "''");
        if (!value) value = '…';
        out = out.split('{{' + name + '}}').join(value);
    }
    return out;
}

function generateSql() {
    if (!catalog) return;
    const band = currentBand();
    const q = currentQuery();
    const sql = applyParams(q.sql, q.params);
    sqlOut.value = sql;

    const items = [];
    (catalog.generalCaveats || []).forEach((c) => items.push(c));
    if (q.caveats) items.push(q.caveats);
    if (band.notes) items.push('Versionsband: ' + band.label + ' — ' + band.notes);

    caveatsEl.innerHTML = '<strong>Att tänka på</strong><ul>' +
        items.map((c) => `<li>${escapeHtml(c)}</li>`).join('') +
        '</ul>';
    caveatsEl.classList.remove('display-none');
    copyButton.disabled = !sql;
}

async function init() {
    try {
        const res = await fetch('../../queries/ios/photos-sqlite/catalog.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        catalog = await res.json();

        metaBox.innerHTML =
            `<strong>DB:</strong> <code>${escapeHtml(catalog.dbPathHint || '')}</code><br>` +
            `${escapeHtml(catalog.timeNote || '')}` +
            (catalog.source ? `<br><strong>Källa/inspiration:</strong> ${escapeHtml(catalog.source)}` : '');
        metaBox.classList.remove('display-none');

        bandSelect.innerHTML = catalog.bands.map((b) =>
            `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`
        ).join('');

        bandSelect.disabled = false;
        querySelect.disabled = false;
        generateButton.disabled = false;

        // Default to newest band
        if (catalog.bands.length) {
            bandSelect.value = catalog.bands[catalog.bands.length - 1].id;
        }

        fillQueries();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda queries/ios/photos-sqlite/catalog.json';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

bandSelect.addEventListener('change', fillQueries);
querySelect.addEventListener('change', () => {
    renderParams();
    generateSql();
});
generateButton.addEventListener('click', generateSql);

copyButton.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(sqlOut.value);
        showToast();
    } catch (e) {
        sqlOut.select();
        document.execCommand('copy');
        showToast();
    }
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

init();
