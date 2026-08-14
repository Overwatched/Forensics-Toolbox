const dbSelect = document.getElementById('db-select');
const querySelect = document.getElementById('query-select');
const paramsEl = document.getElementById('params');
const sqlOut = document.getElementById('sql-out');
const metaBox = document.getElementById('meta-box');
const loadError = document.getElementById('load-error');
const copyButton = document.getElementById('copy-button');
const showQueriesBtn = document.getElementById('show-queries-btn');
const queryPanel = document.getElementById('query-panel');
const recommendedBox = document.getElementById('recommended-box');
const toast = document.getElementById('toast');

const COCOA_EPOCH = 978307200;
const MAX_UNIX = 4102444800;

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

function currentDb() {
    return catalog.databases.find((d) => d.id === dbSelect.value) || catalog.databases[0];
}

function recommendedQuery(db) {
    return (db.queries || []).find((q) => q.recommended) || db.queries[0];
}

function currentQuery() {
    const db = currentDb();
    if (!showQueries) return recommendedQuery(db);
    return (db.queries || []).find((q) => q.id === querySelect.value) || db.queries[0];
}

function unixFromDatetimeLocal(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 1000);
}

function fillTimePlaceholders(sql) {
    const startEl = document.getElementById('param-timeStart');
    const endEl = document.getElementById('param-timeEnd');
    const startUnix = unixFromDatetimeLocal(startEl && startEl.value) ;
    const endUnix = unixFromDatetimeLocal(endEl && endEl.value);

    const cocoaStart = startUnix == null ? 0 : (startUnix - COCOA_EPOCH);
    const cocoaEnd = endUnix == null ? (MAX_UNIX - COCOA_EPOCH) : (endUnix - COCOA_EPOCH);
    const unixStart = startUnix == null ? 0 : startUnix;
    const unixEnd = endUnix == null ? MAX_UNIX : endUnix;
    const unixMsStart = unixStart * 1000;
    const unixMsEnd = unixEnd * 1000;

    return sql
        .split('{{cocoaStart}}').join(String(cocoaStart))
        .split('{{cocoaEnd}}').join(String(cocoaEnd))
        .split('{{unixStart}}').join(String(unixStart))
        .split('{{unixEnd}}').join(String(unixEnd))
        .split('{{unixMsStart}}').join(String(unixMsStart))
        .split('{{unixMsEnd}}').join(String(unixMsEnd));
}

function applyTextParams(sql, params) {
    let out = sql;
    for (const name of params || []) {
        if (name === 'timeStart' || name === 'timeEnd') continue;
        const el = document.getElementById('param-' + name);
        let v = el ? el.value.trim() : '';
        v = v.replace(/'/g, "''");
        out = out.split('{{' + name + '}}').join(v);
    }
    return out;
}

function renderMeta() {
    const db = currentDb();
    const q = currentQuery();
    const source = db.source || '';
    metaBox.innerHTML =
        `<strong>Databas:</strong> <code>${escapeHtml(db.dbPathHint || '')}</code>` +
        (source ? `<br><strong>Källa:</strong> <a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.replace(/^https:\/\/github.com\//, ''))}</a>` : '') +
        (q && q.subtitle ? `<br>${escapeHtml(q.subtitle)}` : '');
    metaBox.classList.remove('display-none');
}

function renderRecommended() {
    const q = recommendedQuery(currentDb());
    recommendedBox.classList.toggle('display-none', showQueries);
    recommendedBox.innerHTML = `
      <div class="q-title"><span class="badge">Rekommenderas</span><span>${escapeHtml(q.title)}</span></div>
      <div class="q-sub">${escapeHtml(q.subtitle || '')}</div>`;
}

function fillQueries() {
    const db = currentDb();
    querySelect.innerHTML = (db.queries || []).map((q) =>
        `<option value="${escapeHtml(q.id)}">${escapeHtml(q.title)}</option>`
    ).join('');
    const rec = recommendedQuery(db);
    querySelect.value = rec.id;
    renderRecommended();
    renderMeta();
    renderParams();
    generateSql();
}

function renderParams() {
    const q = currentQuery();
    const labels = catalog.paramLabels || {};
    const params = q.params || [];
    const timeParams = params.filter((p) => p === 'timeStart' || p === 'timeEnd');
    const other = params.filter((p) => p !== 'timeStart' && p !== 'timeEnd');

    let html = '';
    if (timeParams.length) {
        html += `<div class="step-label">3. Tidsspann</div><div class="time-row">`;
        for (const name of ['timeStart', 'timeEnd']) {
            if (!timeParams.includes(name)) continue;
            html += `
              <div class="param-block">
                <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(labels[name] || name)}</label>
                <input type="datetime-local" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}" step="1">
              </div>`;
        }
        html += `</div>`;
    }
    if (other.length) {
        html += `<div class="step-label">${timeParams.length ? '4' : '3'}. App (valfritt)</div>`;
        html += other.map((name) => `
          <div class="param-block">
            <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(labels[name] || name)}</label>
            <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}"
              spellcheck="false" autocomplete="off" placeholder="${escapeHtml(labels[name] || name)}">
          </div>`).join('');
    }

    paramsEl.innerHTML = html;
    paramsEl.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => {
            sqlDirty = false;
            generateSql();
        });
    });
}

function generateSql() {
    if (!catalog || sqlDirty) return;
    const q = currentQuery();
    if (!q || !q.sql) {
        sqlOut.value = '';
        copyButton.disabled = true;
        return;
    }
    let sql = fillTimePlaceholders(q.sql);
    sql = applyTextParams(sql, q.params || []);
    sqlOut.value = sql;
    copyButton.disabled = !sqlOut.value;
}

async function init() {
    try {
        catalog = await loadLocalJson('../../queries/app-usage/catalog.json', 'APP_USAGE_CATALOG');
        dbSelect.innerHTML = catalog.databases.map((d) =>
            `<option value="${escapeHtml(d.id)}">${escapeHtml(d.label)}</option>`
        ).join('');
        dbSelect.disabled = false;
        fillQueries();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda queries/app-usage/catalog.json';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

dbSelect.addEventListener('change', () => {
    sqlDirty = false;
    fillQueries();
});

querySelect.addEventListener('change', () => {
    sqlDirty = false;
    renderMeta();
    renderParams();
    generateSql();
});

showQueriesBtn.addEventListener('click', () => {
    showQueries = !showQueries;
    queryPanel.classList.toggle('display-none', !showQueries);
    showQueriesBtn.textContent = showQueries ? 'Dölj enskilda queries' : 'Visa enskilda queries';
    if (!showQueries) {
        const rec = recommendedQuery(currentDb());
        querySelect.value = rec.id;
        sqlDirty = false;
        renderMeta();
        renderParams();
        generateSql();
    }
    renderRecommended();
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
