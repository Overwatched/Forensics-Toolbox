const bandSelect = document.getElementById('band-select');
const questionList = document.getElementById('question-list');
const questionDetail = document.getElementById('question-detail');
const bandNotes = document.getElementById('band-notes');
const paramsEl = document.getElementById('params');
const caveatsEl = document.getElementById('caveats');
const columnGuide = document.getElementById('column-guide');
const sqlOut = document.getElementById('sql-out');
const metaBox = document.getElementById('meta-box');
const loadError = document.getElementById('load-error');
const generateButton = document.getElementById('generate-button');
const copyButton = document.getElementById('copy-button');
const toast = document.getElementById('toast');

let catalog = null;
let selectedQuestionId = null;
let showAdvanced = false;

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
        // Hide alt-join unless advanced
        if (q.id === 'full-story-alt-join' && !showAdvanced) return false;
        // Only show alt-join if SQL exists in band
        if (!findSql(q.id)) return false;
        return true;
    });
}

function renderQuestions() {
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
            renderQuestions();
            renderQuestionDetail();
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

function renderQuestionDetail() {
    const q = currentQuestion();
    if (!q) {
        questionDetail.classList.add('display-none');
        return;
    }
    const helps = (q.helpsAnswer || []).map((h) => `<li>${escapeHtml(h)}</li>`).join('');
    questionDetail.innerHTML = `
      <strong>${escapeHtml(q.label)}</strong>
      <div>${escapeHtml(q.subtitle || '')}</div>
      ${helps ? `<ul>${helps}</ul>` : ''}`;
    questionDetail.classList.remove('display-none');
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
      <div class="step-label">3. Fyll i sökvärde</div>
      ${params.map((name) => `
        <div class="param-block">
          <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(labels[name] || name)}</label>
          <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}"
            spellcheck="false" autocomplete="off" placeholder="${escapeHtml(labels[name] || name)}">
        </div>`).join('')}`;

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
        value = value.replace(/'/g, "''");
        if (!value) value = '…';
        out = out.split('{{' + name + '}}').join(value);
    }
    return out;
}

function renderColumnGuide() {
    const guide = catalog.columnGuide || [];
    if (!guide.length) {
        columnGuide.classList.add('display-none');
        return;
    }
    columnGuide.innerHTML = '<strong>Så läser du resultatet</strong><ul>' +
        guide.map((g) => `<li><code>${escapeHtml(g.col)}</code> — ${escapeHtml(g.meaning)}</li>`).join('') +
        '</ul>';
    columnGuide.classList.remove('display-none');
}

function generateSql() {
    if (!catalog) return;
    const band = currentBand();
    const q = currentQuestion();
    const rawSql = findSql(q.id);

    if (!rawSql) {
        sqlOut.value = '';
        copyButton.disabled = true;
        caveatsEl.innerHTML = '<strong>Saknas</strong><ul><li>Den här frågan finns inte för valt iOS-band.</li></ul>';
        caveatsEl.classList.remove('display-none');
        return;
    }

    const sql = applyParams(rawSql, q.params || []);
    sqlOut.value = sql;

    const items = [];
    (catalog.generalCaveats || []).forEach((c) => items.push(c));
    if (band.notes) items.push('Versionsband: ' + band.label + ' — ' + band.notes);
    if ((q.params || []).includes('filename')) {
        items.push('Om du får 0 rader: prova kortare del av filnamnet, eller Avancerat → alternativ JOIN.');
    }

    caveatsEl.innerHTML = '<strong>Att tänka på</strong><ul>' +
        items.map((c) => `<li>${escapeHtml(c)}</li>`).join('') +
        '</ul>';
    caveatsEl.classList.remove('display-none');
    renderColumnGuide();
    copyButton.disabled = !sql;
}

function onBandChange() {
    const band = currentBand();
    if (band.notes) {
        bandNotes.textContent = band.notes;
        bandNotes.classList.remove('display-none');
    } else {
        bandNotes.classList.add('display-none');
    }

    // Keep selection if still valid, else recommended
    if (!findSql(selectedQuestionId)) {
        const rec = (catalog.questions || []).find((q) => q.recommended && findSql(q.id));
        selectedQuestionId = rec ? rec.id : (visibleQuestions()[0] || {}).id;
    }

    renderQuestions();
    renderQuestionDetail();
    renderParams();
    generateSql();
}

async function init() {
    try {
        const res = await fetch('../../queries/ios/photos-sqlite/catalog.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        catalog = await res.json();

        metaBox.innerHTML =
            `<strong>Databas:</strong> <code>${escapeHtml(catalog.dbPathHint || '')}</code><br>` +
            `${escapeHtml(catalog.timeNote || '')}`;
        metaBox.classList.remove('display-none');

        bandSelect.innerHTML = catalog.bands.map((b) =>
            `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`
        ).join('');

        bandSelect.disabled = false;
        generateButton.disabled = false;

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
