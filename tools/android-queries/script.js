const categorySelect = document.getElementById('category-select');
const querySelect = document.getElementById('query-select');
const pathHints = document.getElementById('path-hints');
const paramsEl = document.getElementById('params');
const sqlOut = document.getElementById('sql-out');
const metaBox = document.getElementById('meta-box');
const loadError = document.getElementById('load-error');
const copyButton = document.getElementById('copy-button');
const showQueriesBtn = document.getElementById('show-queries-btn');
const queryPanel = document.getElementById('query-panel');
const recommendedBox = document.getElementById('recommended-box');
const toast = document.getElementById('toast');

let catalog = null;
let showQueries = false;
let sqlDirty = false;

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

function recommendedQuery() {
    for (const cat of catalog.categories || []) {
        const q = (cat.queries || []).find((item) => item.recommended);
        if (q) return { cat, q };
    }
    const cat = catalog.categories[0];
    return { cat, q: cat.queries[0] };
}

function currentCategory() {
    return catalog.categories.find((c) => c.id === categorySelect.value) || catalog.categories[0];
}

function currentQuery() {
    if (!showQueries) return recommendedQuery().q;
    const cat = currentCategory();
    return (cat.queries || []).find((q) => q.id === querySelect.value) || cat.queries[0];
}

function currentCategoryForQuery() {
    if (!showQueries) return recommendedQuery().cat;
    return currentCategory();
}

function fillQueries() {
    const cat = currentCategory();
    querySelect.innerHTML = (cat.queries || []).map((q) =>
        `<option value="${escapeHtml(q.id)}">${escapeHtml(q.title)}</option>`
    ).join('');

    if (cat.dbPathHints && cat.dbPathHints.length) {
        pathHints.innerHTML = '<strong>Typiska paths</strong><ul>' +
            cat.dbPathHints.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join('') +
            '</ul>';
        pathHints.classList.remove('display-none');
    } else {
        pathHints.classList.add('display-none');
    }

    sqlDirty = false;
    renderParams();
    generateSql();
}

function renderRecommended() {
    const { q } = recommendedQuery();
    recommendedBox.classList.toggle('display-none', showQueries);
    recommendedBox.innerHTML = `
      <div class="q-title"><span class="badge">Rekommenderas</span><span>${escapeHtml(q.title)}</span></div>
      <div class="q-sub">Kolumnnamnen är desamma som i databasen.</div>`;
}

function setQueryPanelVisible() {
    queryPanel.classList.toggle('display-none', !showQueries);
    showQueriesBtn.textContent = showQueries ? 'Dölj enskilda queries' : 'Visa enskilda queries';
    renderRecommended();
}

function renderParams() {
    const q = currentQuery();
    const labels = catalog.paramLabels || {};
    const params = q.params || [];

    if (!params.length) {
        paramsEl.innerHTML = '';
        return;
    }

    paramsEl.innerHTML = `
      <div class="step-label">2. Filnamn / sökvärde</div>
      ${params.map((name) => `
        <div class="param-block">
          <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(labels[name] || name)}</label>
          <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}"
            spellcheck="false" autocomplete="off" placeholder="${escapeHtml(labels[name] || name)}">
        </div>
      `).join('')}`;

    paramsEl.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => {
            sqlDirty = false;
            generateSql();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sqlDirty = false;
                generateSql();
            }
        });
    });
}

function splitTerms(raw) {
    const terms = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
    return terms.length ? terms : ['…'];
}

function applyListParam(sql, name, raw) {
    const placeholder = '{{' + name + '}}';
    if (!sql.includes(placeholder)) return sql;

    const values = splitTerms(raw).map((t) => t.replace(/'/g, "''"));
    if (values.length === 1) {
        return sql.split(placeholder).join(values[0]);
    }

    const whereMatch = sql.match(/WHERE\s+([\s\S]*?)(?=\nORDER BY|\nLIMIT|;?\s*$)/i);
    if (!whereMatch) {
        return sql.split(placeholder).join(values[0]);
    }

    const whereBody = whereMatch[1];
    const expanded = values.map((term) => {
        return '(' + whereBody.split(placeholder).join(term).trim().replace(/;?\s*$/, '') + ')';
    }).join('\n   OR ');

    return sql.slice(0, whereMatch.index) + 'WHERE\n   ' + expanded + '\n' + sql.slice(whereMatch.index + whereMatch[0].length);
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
            out = out.split('{{' + name + '}}').join(value);
        } else if (name === 'filename' || name === 'packageName') {
            out = applyListParam(out, name, value);
        } else {
            value = value.replace(/'/g, "''");
            if (!value) value = '…';
            out = out.split('{{' + name + '}}').join(value);
        }
    }
    return out;
}

function generateSql() {
    if (!catalog) return;
    if (sqlDirty) return;
    const q = currentQuery();
    const sql = applyParams(q.sql, q.params);
    sqlOut.value = sql;
    copyButton.disabled = !sql;
}

async function init() {
    try {
        catalog = await loadLocalJson('../../queries/android/catalog.json', 'ANDROID_QUERIES_CATALOG');

        const rec = recommendedQuery();
        metaBox.innerHTML =
            `<strong>Databas:</strong> <code>${escapeHtml((rec.cat.dbPathHints && rec.cat.dbPathHints[0]) || 'external.db')}</code>` +
            (catalog.sourceNote ? `<br>${escapeHtml(catalog.sourceNote)}` : '');
        metaBox.classList.remove('display-none');

        categorySelect.innerHTML = catalog.categories.map((c) =>
            `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`
        ).join('');

        categorySelect.disabled = false;
        querySelect.disabled = false;

        categorySelect.value = rec.cat.id;
        fillQueries();
        querySelect.value = rec.q.id;
        setQueryPanelVisible();
        renderParams();
        generateSql();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda queries/android/catalog.json';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

categorySelect.addEventListener('change', fillQueries);
querySelect.addEventListener('change', () => {
    sqlDirty = false;
    renderParams();
    generateSql();
});

showQueriesBtn.addEventListener('click', () => {
    showQueries = !showQueries;
    if (!showQueries) {
        const rec = recommendedQuery();
        categorySelect.value = rec.cat.id;
        fillQueries();
        querySelect.value = rec.q.id;
        sqlDirty = false;
        renderParams();
        generateSql();
    }
    setQueryPanelVisible();
});

sqlOut.addEventListener('input', () => {
    sqlDirty = true;
    copyButton.disabled = !sqlOut.value;
});

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
