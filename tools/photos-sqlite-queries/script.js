const bandSelect = document.getElementById('band-select');
const questionList = document.getElementById('question-list');
const paramsEl = document.getElementById('params');
const sqlOut = document.getElementById('sql-out');
const metaBox = document.getElementById('meta-box');
const loadError = document.getElementById('load-error');
const copyButton = document.getElementById('copy-button');
const showQueriesBtn = document.getElementById('show-queries-btn');
const recommendedBox = document.getElementById('recommended-box');
const toast = document.getElementById('toast');

let catalog = null;
let selectedQuestionId = null;
let showQueries = false;
let showAdvanced = false;
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

function currentBand() {
    return catalog.bands.find((b) => b.id === bandSelect.value) || catalog.bands[0];
}

function currentQuestion() {
    return (catalog.questions || []).find((q) => q.id === selectedQuestionId)
        || (catalog.questions || []).find((q) => q.recommended)
        || catalog.questions[0];
}

function findSql(questionId) {
    const band = currentBand();
    const entry = (band.queries || []).find((q) => q.id === questionId);
    return entry ? entry.sql : null;
}

function visibleQuestions() {
    const bandId = currentBand().id;
    return (catalog.questions || []).filter((q) => {
        if (q.onlyBands && !q.onlyBands.includes(bandId)) return false;
        if (q.group === 'advanced' && !showAdvanced) return false;
        if (q.id === 'full-story-alt-join' && !showAdvanced) return false;
        if (!findSql(q.id)) return false;
        return true;
    });
}

function renderRecommended() {
    const q = currentQuestion();
    const isDefault = q && q.recommended;
    recommendedBox.classList.toggle('display-none', showQueries);
    recommendedBox.innerHTML = `
      <div class="q-title"><span class="badge">Rekommenderas</span><span>${escapeHtml(q ? q.label : 'Standardquery för Photos.sqlite')}</span></div>
      <div class="q-sub">${escapeHtml(q && q.subtitle ? q.subtitle : '')}</div>`;
    if (!isDefault && showQueries) {
        recommendedBox.classList.add('display-none');
    }
}

function renderQuestions() {
    if (!showQueries) {
        questionList.classList.add('display-none');
        showQueriesBtn.textContent = 'Visa enskilda queries';
        renderRecommended();
        return;
    }

    questionList.classList.remove('display-none');
    showQueriesBtn.textContent = 'Dölj enskilda queries';
    recommendedBox.classList.add('display-none');

    const items = visibleQuestions();
    const investigate = items.filter((q) => q.group !== 'advanced');
    const advanced = items.filter((q) => q.group === 'advanced');

    let html = investigate.map((q) => cardHtml(q)).join('');
    html += `<button type="button" class="advanced-toggle" id="advanced-toggle">
        ${showAdvanced ? 'Dölj avancerat ▲' : 'Visa avancerat (schema m.m.) ▼'}
    </button>`;
    if (showAdvanced) {
        html += advanced.map((q) => cardHtml(q, true)).join('');
    }

    questionList.innerHTML = html;

    questionList.querySelectorAll('.q-card').forEach((btn) => {
        btn.addEventListener('click', () => {
            selectedQuestionId = btn.dataset.id;
            sqlDirty = false;
            renderQuestions();
            renderParams();
            generateSql();
        });
    });

    const toggle = document.getElementById('advanced-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            showAdvanced = !showAdvanced;
            renderQuestions();
        });
    }
}

function cardHtml(q, advanced) {
    const active = q.id === selectedQuestionId ? ' active' : '';
    const adv = advanced || q.group === 'advanced' ? ' advanced' : '';
    const badge = q.recommended ? '<span class="badge">Rekommenderas</span>' : '';
    return `
      <button type="button" class="q-card${active}${adv}" data-id="${escapeHtml(q.id)}">
        <div class="q-title">${badge}<span>${escapeHtml(q.label)}</span></div>
        <div class="q-sub">${escapeHtml(q.subtitle || '')}</div>
      </button>`;
}

function renderParams() {
    const q = currentQuestion();
    const labels = catalog.paramLabels || {};
    const params = (q && q.params) || [];

    if (!params.length) {
        paramsEl.innerHTML = '';
        return;
    }

    paramsEl.innerHTML = `
      <div class="step-label">3. Filnamn / sökvärde</div>
      ${params.map((name) => `
        <div class="param-block">
          <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(labels[name] || name)}</label>
          <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}"
            spellcheck="false" autocomplete="off" placeholder="${escapeHtml(labels[name] || name)}">
        </div>`).join('')}`;

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
        const value = el ? el.value.trim() : '';
        if (name === 'filename' || name === 'bundleId') {
            out = applyListParam(out, name, value);
        } else {
            let v = value.replace(/'/g, "''");
            if (!v) v = '…';
            out = out.split('{{' + name + '}}').join(v);
        }
    }
    return out;
}

function generateSql() {
    if (!catalog) return;
    if (sqlDirty) return;
    const q = currentQuestion();
    const rawSql = findSql(q.id);

    if (!rawSql) {
        sqlOut.value = '';
        copyButton.disabled = true;
        return;
    }

    sqlOut.value = applyParams(rawSql, q.params || []);
    copyButton.disabled = !sqlOut.value;
}

function onBandChange() {
    if (!findSql(selectedQuestionId)) {
        const rec = (catalog.questions || []).find((q) => q.recommended && findSql(q.id));
        selectedQuestionId = rec ? rec.id : (visibleQuestions()[0] || {}).id;
    }
    sqlDirty = false;
    renderQuestions();
    renderParams();
    generateSql();
}

async function init() {
    try {
        catalog = await loadLocalJson(
            '../../queries/ios/photos-sqlite/catalog.json',
            'PHOTOS_SQLITE_CATALOG'
        );

        metaBox.innerHTML =
            `<strong>Databas:</strong> <code>${escapeHtml(catalog.dbPathHint || '')}</code>` +
            (catalog.timeNote ? `<br>${escapeHtml(catalog.timeNote)}` : '');
        metaBox.classList.remove('display-none');

        bandSelect.innerHTML = catalog.bands.map((b) =>
            `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`
        ).join('');

        bandSelect.disabled = false;

        if (catalog.bands.length) {
            bandSelect.value = catalog.bands[catalog.bands.length - 1].id;
        }

        const rec = (catalog.questions || []).find((q) => q.recommended);
        selectedQuestionId = rec ? rec.id : catalog.questions[0].id;

        onBandChange();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda queries/ios/photos-sqlite/catalog.json';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

bandSelect.addEventListener('change', onBandChange);

showQueriesBtn.addEventListener('click', () => {
    showQueries = !showQueries;
    if (!showQueries) {
        const rec = (catalog.questions || []).find((q) => q.recommended && findSql(q.id));
        if (rec) selectedQuestionId = rec.id;
        sqlDirty = false;
        renderParams();
        generateSql();
    }
    renderQuestions();
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
