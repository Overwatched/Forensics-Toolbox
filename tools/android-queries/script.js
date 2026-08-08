const categorySelect = document.getElementById('category-select');
const querySelect = document.getElementById('query-select');
const categoryNotes = document.getElementById('category-notes');
const pathHints = document.getElementById('path-hints');
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

function currentCategory() {
    return catalog.categories.find((c) => c.id === categorySelect.value) || catalog.categories[0];
}

function currentQuery() {
    const cat = currentCategory();
    return (cat.queries || []).find((q) => q.id === querySelect.value) || cat.queries[0];
}

function fillQueries() {
    const cat = currentCategory();
    querySelect.innerHTML = (cat.queries || []).map((q) =>
        `<option value="${escapeHtml(q.id)}">${escapeHtml(q.title)}</option>`
    ).join('');

    if (cat.notes) {
        categoryNotes.innerHTML = `<strong>${escapeHtml(cat.label)}</strong> (${escapeHtml(cat.apiHint || '')})<br>${escapeHtml(cat.notes)}`;
        categoryNotes.classList.remove('display-none');
    } else {
        categoryNotes.classList.add('display-none');
    }

    if (cat.dbPathHints && cat.dbPathHints.length) {
        pathHints.innerHTML = '<strong>Typiska paths</strong><ul>' +
            cat.dbPathHints.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join('') +
            '</ul>';
        pathHints.classList.remove('display-none');
    } else {
        pathHints.classList.add('display-none');
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
        const numeric = name === 'unixStart' || name === 'unixEnd';
        if (numeric) {
            value = value.replace(/[^\d-]/g, '');
            if (!value) value = '0';
        } else {
            value = value.replace(/'/g, "''");
            if (!value) value = '…';
        }
        out = out.split('{{' + name + '}}').join(value);
    }
    return out;
}

function generateSql() {
    if (!catalog) return;
    const cat = currentCategory();
    const q = currentQuery();
    const sql = applyParams(q.sql, q.params);
    sqlOut.value = sql;

    const items = [];
    (catalog.generalCaveats || []).forEach((c) => items.push(c));
    if (q.caveats) items.push(q.caveats);
    if (cat.notes) items.push(cat.label + ': ' + cat.notes);

    caveatsEl.innerHTML = '<strong>Att tänka på</strong><ul>' +
        items.map((c) => `<li>${escapeHtml(c)}</li>`).join('') +
        '</ul>';
    caveatsEl.classList.remove('display-none');
    copyButton.disabled = !sql;
}

async function init() {
    try {
        const res = await fetch('../../queries/android/catalog.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        catalog = await res.json();

        metaBox.innerHTML =
            `${escapeHtml(catalog.sourceNote || '')}` +
            (catalog.source ? `<br><strong>Källa:</strong> ${escapeHtml(catalog.source)}` : '');
        metaBox.classList.remove('display-none');

        categorySelect.innerHTML = catalog.categories.map((c) =>
            `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`
        ).join('');

        categorySelect.disabled = false;
        querySelect.disabled = false;
        generateButton.disabled = false;

        fillQueries();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda queries/android/catalog.json';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

categorySelect.addEventListener('change', fillQueries);
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
