const dbSelect = document.getElementById('db-select');
const querySelect = document.getElementById('query-select');
const paramsEl = document.getElementById('params');
const sqlOut = document.getElementById('sql-out');
const sqlView = document.getElementById('sql-view');
const metaBox = document.getElementById('meta-box');
const flowBox = document.getElementById('flow-box');
const loadError = document.getElementById('load-error');
const copyButton = document.getElementById('copy-button');
const editButton = document.getElementById('edit-button');
const showQueriesBtn = document.getElementById('show-queries-btn');
const queryPanel = document.getElementById('query-panel');
const recommendedBox = document.getElementById('recommended-box');
const workspace = document.getElementById('workspace');
const toast = document.getElementById('toast');

const COCOA_EPOCH = 978307200;
const MAX_UNIX = 4102444800;
const TIME_NAMES = new Set(['timeStart', 'timeEnd', 'unixStart', 'unixEnd']);
const LIST_NAMES = new Set(['filename', 'bundleId', 'packageName']);
const KW_RE = /\b(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|INNER|ON|AS|CASE|WHEN|THEN|ELSE|END|ORDER|BY|GROUP|LIMIT|LIKE|IFNULL|BETWEEN|IN|NOT|NULL|DISTINCT|UNION|ALL|DESC|ASC|PRAGMA)\b/g;

const ALIASES = {
    photos: 'photos-ios17-plus',
    'photos-sqlite': 'photos-ios17-plus',
    ios: 'photos-ios17-plus',
    android: 'android-mediastore',
    mediastore: 'android-mediastore',
    'app-usage': 'knowledgec',
    'android-wellbeing': 'wellbeing',
};

let databases = [];
let paramLabels = {};
let showQueries = false;
let sqlDirty = false;
let editing = false;
let plainSql = '';

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showToast(text) {
    toast.textContent = text || 'Kopierat';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1200);
}

function currentDb() {
    return databases.find((d) => d.id === dbSelect.value) || null;
}

function recommendedQuery(db) {
    if (!db) return null;
    return (db.queries || []).find((q) => q.recommended) || db.queries[0] || null;
}

function currentQuery() {
    const db = currentDb();
    if (!db) return null;
    if (!showQueries) return recommendedQuery(db);
    return (db.queries || []).find((q) => q.id === querySelect.value) || db.queries[0];
}

function unixFromUserTime(value) {
    if (value == null) return null;
    const t = String(value).trim();
    if (!t) return null;
    if (/^\d{10}$/.test(t)) return Number(t);
    if (/^\d{13}$/.test(t)) return Math.floor(Number(t) / 1000);
    let s = t.replace(/\//g, '-');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    s = s.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00';
    const ms = new Date(s).getTime();
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 1000);
}

function splitTerms(raw) {
    const terms = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
    return terms;
}

function isCommentHeavy(sql) {
    const code = String(sql || '').split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('--'))
        .join('');
    return !code.trim();
}

function formatSql(sql) {
    let s = String(sql || '').replace(/\r\n/g, '\n');
    if (isCommentHeavy(s)) return s.trim();
    const holes = [];
    s = s.replace(/\bBETWEEN\s+(\S+)\s+AND\s+(\S+)/gi, (m) => {
        const k = '\u0000B' + holes.length + '\u0000';
        holes.push(m);
        return k;
    });
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/ *\n */g, '\n');
    s = s.replace(/\s+(FROM|WHERE|LEFT JOIN|INNER JOIN|GROUP BY|ORDER BY|LIMIT|UNION ALL|UNION)\s+/gi, '\n$1 ');
    s = s.replace(/\s+(AND|OR)\s+/gi, '\n  $1 ');
    holes.forEach((orig, i) => {
        s = s.split('\u0000B' + i + '\u0000').join(orig);
    });
    return s.replace(/\n{3,}/g, '\n\n').trim();
}

function colorKeywords(escaped) {
    return escaped.replace(KW_RE, '<span class="sql-kw">$1</span>');
}

function highlightSql(formatted, parts) {
    let html = colorKeywords(escapeHtml(formatted));
    parts.forEach((p, i) => {
        const token = '\u0001U' + i + '\u0001';
        const cls = p.user ? 'sql-user' : 'sql-default';
        const title = p.user ? 'Värde du skrev in' : 'Standard (inget ifyllt)';
        html = html.split(token).join(
            '<mark class="' + cls + '" title="' + title + '">' + escapeHtml(p.value) + '</mark>'
        );
    });
    return html;
}

function paramValue(name) {
    const el = document.getElementById('param-' + name);
    return el ? el.value.trim() : '';
}

function replaceToken(sql, token, value) {
    return sql.split(token).join(value);
}

function applyListParam(sql, name, raw, parts) {
    const placeholder = '{{' + name + '}}';
    if (!sql.includes(placeholder)) return sql;
    const terms = splitTerms(raw);
    const user = terms.length > 0;
    const values = (terms.length ? terms : ['…']).map((t) => t.replace(/'/g, "''"));

    function take(val) {
        const i = parts.length;
        parts.push({ value: val, user: user });
        return '\u0001U' + i + '\u0001';
    }

    if (values.length === 1) {
        return replaceToken(sql, placeholder, take(values[0]));
    }

    const whereMatch = sql.match(/WHERE\s+([\s\S]*?)(?=\nORDER BY|\nLIMIT|;?\s*$)/i);
    if (!whereMatch) {
        return replaceToken(sql, placeholder, take(values[0]));
    }

    const whereBody = whereMatch[1];
    const expanded = values.map((term) => {
        return '(' + whereBody.split(placeholder).join(take(term)).trim().replace(/;?\s*$/, '') + ')';
    }).join('\n   OR ');

    return sql.slice(0, whereMatch.index) + 'WHERE\n   ' + expanded + '\n' + sql.slice(whereMatch.index + whereMatch[0].length);
}

function takePart(parts, value, user) {
    const i = parts.length;
    parts.push({ value: String(value), user: !!user });
    return '\u0001U' + i + '\u0001';
}

function fillTimePlaceholders(sql, parts) {
    const startRaw = paramValue('timeStart');
    const endRaw = paramValue('timeEnd');
    const startUnix = unixFromUserTime(startRaw);
    const endUnix = unixFromUserTime(endRaw);

    const cocoaStart = startUnix == null ? 0 : (startUnix - COCOA_EPOCH);
    const cocoaEnd = endUnix == null ? (MAX_UNIX - COCOA_EPOCH) : (endUnix - COCOA_EPOCH);
    const unixStart = startUnix == null ? 0 : startUnix;
    const unixEnd = endUnix == null ? MAX_UNIX : endUnix;

    const pairs = [
        ['{{cocoaStart}}', cocoaStart, !!startRaw && startUnix != null],
        ['{{cocoaEnd}}', cocoaEnd, !!endRaw && endUnix != null],
        ['{{unixStart}}', unixStart, !!startRaw && startUnix != null],
        ['{{unixEnd}}', unixEnd, !!endRaw && endUnix != null],
        ['{{unixMsStart}}', unixStart * 1000, !!startRaw && startUnix != null],
        ['{{unixMsEnd}}', unixEnd * 1000, !!endRaw && endUnix != null],
    ];
    let out = sql;
    for (const [token, value, user] of pairs) {
        if (!out.includes(token)) continue;
        out = replaceToken(out, token, takePart(parts, value, user));
    }
    return out;
}

function applyTextParams(sql, params, parts) {
    let out = sql;
    for (const name of params || []) {
        if (TIME_NAMES.has(name)) continue;
        const raw = paramValue(name);
        if (LIST_NAMES.has(name)) {
            out = applyListParam(out, name, raw, parts);
        } else {
            const token = '{{' + name + '}}';
            if (!out.includes(token)) continue;
            let v = raw.replace(/'/g, "''");
            const user = !!raw;
            if (!v) v = '…';
            out = replaceToken(out, token, takePart(parts, v, user));
        }
    }
    return out;
}

function stripSentinels(sql, parts) {
    let out = sql;
    parts.forEach((p, i) => {
        out = out.split('\u0001U' + i + '\u0001').join(p.value);
    });
    return out;
}

function buildSql() {
    const q = currentQuery();
    if (!q || !q.sql) return { plain: '', html: '' };
    const parts = [];
    let sql = fillTimePlaceholders(q.sql, parts);
    sql = applyTextParams(sql, q.params || [], parts);
    sql = formatSql(sql);
    const plain = stripSentinels(sql, parts);
    const html = highlightSql(sql, parts);
    return { plain, html };
}

function renderMeta() {
    const db = currentDb();
    if (!db) {
        metaBox.classList.add('display-none');
        return;
    }
    const source = db.source || '';
    const extra = db.dbPathHints && db.dbPathHints.length
        ? db.dbPathHints.map((p) => '<code>' + escapeHtml(p) + '</code>').join('<br>')
        : '<code>' + escapeHtml(db.dbPathHint || '') + '</code>';
    metaBox.innerHTML =
        '<strong>Databas:</strong> ' + extra +
        (source ? '<br><strong>Källa:</strong> <a href="' + escapeHtml(source) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(source.replace(/^https:\/\/github.com\//, '')) + '</a>' : '') +
        (db.note ? '<br>' + escapeHtml(db.note) : '');
    metaBox.classList.remove('display-none');
}

function renderFlow() {
    const db = currentDb();
    if (!db) {
        flowBox.innerHTML = '';
        return;
    }
    const steps = db.flow || [
        'Läs in databasen + <code>-wal</code> + <code>-shm</code>',
        'Standardquery, eller visa enskilda queries',
        'Fyll i värden (tid, filnamn, app)',
        'Kopiera SQL och kör i DB Browser',
    ];
    flowBox.innerHTML = '<h2>Kort flöde</h2><ol>' +
        steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>' +
        (db.footerHtml || '');
}

function renderRecommended() {
    const q = recommendedQuery(currentDb());
    recommendedBox.classList.toggle('display-none', showQueries || !q);
    if (!q) return;
    recommendedBox.innerHTML =
        '<div class="q-title"><span class="badge">Rekommenderas</span><span>' + escapeHtml(q.title) + '</span></div>' +
        '<div class="q-sub">' + escapeHtml(q.subtitle || '') + '</div>';
}

function fillQuerySelect() {
    const db = currentDb();
    querySelect.innerHTML = (db.queries || []).map((q) => {
        const prefix = q.group === 'advanced' ? 'Avancerat: ' : '';
        return '<option value="' + escapeHtml(q.id) + '">' + escapeHtml(prefix + q.title) + '</option>';
    }).join('');
    const rec = recommendedQuery(db);
    if (rec) querySelect.value = rec.id;
}

function hasTimeParams(params) {
    return (params || []).some((p) => TIME_NAMES.has(p));
}

function renderParams() {
    const q = currentQuery();
    const params = (q && q.params) || [];
    const timeParams = hasTimeParams(params);
    const other = params.filter((p) => !TIME_NAMES.has(p));

    let html = '';
    let step = 3;
    if (timeParams) {
        html += '<div class="step-label">' + step + '. Tidsspann</div><div class="time-row">';
        html += `
          <div class="param-block">
            <label class="field-label" for="param-timeStart">${escapeHtml(paramLabels.timeStart || 'Från (ÅÅÅÅ-MM-DD TT:MM)')}</label>
            <input type="text" id="param-timeStart" spellcheck="false" autocomplete="off" placeholder="2024-08-01 00:00">
          </div>
          <div class="param-block">
            <label class="field-label" for="param-timeEnd">${escapeHtml(paramLabels.timeEnd || 'Till (ÅÅÅÅ-MM-DD TT:MM)')}</label>
            <input type="text" id="param-timeEnd" spellcheck="false" autocomplete="off" placeholder="2024-08-14 23:59">
          </div>`;
        html += '</div><div id="time-preview" class="time-preview"></div>';
        step += 1;
    }
    if (other.length) {
        html += '<div class="step-label">' + step + '. Sökvärde</div>';
        html += other.map((name) => `
          <div class="param-block">
            <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(paramLabels[name] || name)}</label>
            <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}"
              spellcheck="false" autocomplete="off" placeholder="${escapeHtml(paramLabels[name] || name)}">
          </div>`).join('');
    }

    paramsEl.innerHTML = html;
    paramsEl.querySelectorAll('input').forEach((input) => {
        const refresh = () => {
            sqlDirty = false;
            generateSql();
        };
        input.addEventListener('input', refresh);
        input.addEventListener('change', refresh);
        input.addEventListener('blur', refresh);
    });
}

function updateTimePreview() {
    const el = document.getElementById('time-preview');
    if (!el) return;
    const startRaw = paramValue('timeStart');
    const endRaw = paramValue('timeEnd');
    if (!startRaw && !endRaw) {
        el.textContent = 'Ingen tidsgräns — tomt fält = hela databasen.';
        return;
    }
    const startUnix = unixFromUserTime(startRaw);
    const endUnix = unixFromUserTime(endRaw);
    const bad = [];
    if (startRaw && startUnix == null) bad.push('Från');
    if (endRaw && endUnix == null) bad.push('Till');
    if (bad.length) {
        el.textContent = 'Ogiltigt datum i ' + bad.join(' och ') + '. Använd ÅÅÅÅ-MM-DD TT:MM.';
        return;
    }
    el.textContent = 'Unix ' + (startUnix == null ? 0 : startUnix) + '–' + (endUnix == null ? MAX_UNIX : endUnix) +
        ' · Cocoa ' + ((startUnix == null ? 0 : startUnix) - COCOA_EPOCH) + '–' +
        ((endUnix == null ? MAX_UNIX : endUnix) - COCOA_EPOCH) + '.';
}

function setEditMode(on) {
    editing = on;
    sqlOut.classList.toggle('display-none', !on);
    sqlView.hidden = on;
    editButton.textContent = on ? 'Visa färgad SQL' : 'Redigera SQL';
}

function generateSql() {
    if (sqlDirty) return;
    const built = buildSql();
    plainSql = built.plain;
    sqlOut.value = built.plain;
    sqlView.innerHTML = built.html || '';
    copyButton.disabled = !built.plain;
    updateTimePreview();
    if (!editing) setEditMode(false);
}

function onDbChange() {
    const db = currentDb();
    workspace.classList.toggle('display-none', !db);
    showQueries = false;
    sqlDirty = false;
    setEditMode(false);
    queryPanel.classList.add('display-none');
    showQueriesBtn.textContent = 'Visa enskilda queries';
    if (!db) {
        sqlView.innerHTML = '';
        sqlOut.value = '';
        copyButton.disabled = true;
        return;
    }
    fillQuerySelect();
    renderRecommended();
    renderMeta();
    renderFlow();
    renderParams();
    generateSql();
}

function buildDatabases(photos, android, appUsage) {
    const out = [];
    paramLabels = Object.assign(
        {
            timeStart: 'Från (ÅÅÅÅ-MM-DD TT:MM)',
            timeEnd: 'Till (ÅÅÅÅ-MM-DD TT:MM)',
        },
        photos.paramLabels || {},
        android.paramLabels || {},
        appUsage.paramLabels || {}
    );

    (photos.bands || []).forEach((band) => {
        const sqlById = {};
        (band.queries || []).forEach((q) => { sqlById[q.id] = q.sql; });
        const queries = (photos.questions || []).filter((q) => {
            if (q.onlyBands && !q.onlyBands.includes(band.id)) return false;
            return !!sqlById[q.id];
        }).map((q) => ({
            id: q.id,
            title: q.label,
            subtitle: q.subtitle || '',
            recommended: !!q.recommended,
            params: q.params || [],
            group: q.group,
            sql: sqlById[q.id],
        }));
        out.push({
            id: 'photos-' + band.id,
            os: 'iOS',
            label: 'Photos.sqlite (' + band.label + ')',
            dbPathHint: photos.dbPathHint,
            source: photos.source,
            note: photos.timeNote,
            flow: [
                'Läs in <code>Photos.sqlite</code> + <code>-wal</code> + <code>-shm</code>',
                'Standardquery för Photos.sqlite',
                'Ange filnamn',
                'Kopiera SQL och kör i DB Browser',
            ],
            queries: queries,
        });
    });

    (appUsage.databases || []).forEach((db) => {
        out.push({
            id: db.id,
            os: /android|wellbeing/i.test(db.label) ? 'Android' : 'iOS',
            label: db.label.replace(/^iOS — /, '').replace(/^Android — /, ''),
            dbPathHint: db.dbPathHint,
            source: db.source,
            note: appUsage.sourceNote,
            flow: [
                'Läs in databasen + <code>-wal</code> + <code>-shm</code>',
                'Standardquery, eller visa enskilda queries',
                'Ange tidsspann som <code>ÅÅÅÅ-MM-DD TT:MM</code>',
                'Kopiera SQL och kör i DB Browser',
            ],
            footerHtml: db.id === 'knowledgec'
                ? '<p style="margin-top:8px">Biome <code>App.InFocus</code> är SEGB/protobuf, inte SQL — använd iLEAPP.</p>'
                : '',
            queries: (db.queries || []).map((q) => ({
                id: q.id,
                title: q.title,
                subtitle: q.subtitle || '',
                recommended: !!q.recommended,
                params: q.params || [],
                sql: q.sql,
            })),
        });
    });

    (android.categories || []).forEach((cat) => {
        const queries = (cat.queries || []).map((q) => ({
            id: q.id,
            title: q.title,
            subtitle: q.goal || '',
            recommended: !!q.recommended,
            params: q.params || [],
            sql: q.sql,
        }));
        out.push({
            id: 'android-' + cat.id,
            os: 'Android',
            label: cat.label + (cat.id === 'mediastore' ? ' (external.db)' : ''),
            dbPathHint: (cat.dbPathHints && cat.dbPathHints[0]) || '',
            dbPathHints: cat.dbPathHints,
            source: android.source,
            note: android.sourceNote,
            flow: [
                'Läs in databasen + <code>-wal</code> + <code>-shm</code>',
                'Standardquery, eller visa enskilda queries',
                'Fyll i filnamn / tid / paket om queryn frågar efter det',
                'Kopiera SQL och kör i DB Browser',
            ],
            queries: queries,
        });
    });

    const order = [
        'photos-ios10-12', 'photos-ios13-14', 'photos-ios15-16', 'photos-ios17-plus',
        'knowledgec', 'interactionc',
        'android-mediastore', 'android-camera', 'wellbeing', 'android-usage',
    ];
    out.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return out;
}

function fillDbSelect() {
    const groups = { iOS: [], Android: [] };
    databases.forEach((d) => {
        (groups[d.os] || (groups[d.os] = [])).push(d);
    });
    let html = '<option value="">Välj databas…</option>';
    Object.keys(groups).forEach((os) => {
        html += '<optgroup label="' + escapeHtml(os) + '">';
        groups[os].forEach((d) => {
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.label) + '</option>';
        });
        html += '</optgroup>';
    });
    dbSelect.innerHTML = html;
    dbSelect.disabled = false;
}

function applyDeepLink() {
    const params = new URLSearchParams(location.search);
    let id = params.get('db') || '';
    if (ALIASES[id]) id = ALIASES[id];
    if (id && databases.some((d) => d.id === id)) {
        dbSelect.value = id;
        onDbChange();
    }
}

async function init() {
    try {
        const [photos, android, appUsage] = await Promise.all([
            loadLocalJson('../../queries/ios/photos-sqlite/catalog.json', 'PHOTOS_SQLITE_CATALOG'),
            loadLocalJson('../../queries/android/catalog.json', 'ANDROID_QUERIES_CATALOG'),
            loadLocalJson('../../queries/app-usage/catalog.json', 'APP_USAGE_CATALOG'),
        ]);
        databases = buildDatabases(photos, android, appUsage);
        fillDbSelect();
        applyDeepLink();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda query-katalogerna';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

dbSelect.addEventListener('change', () => {
    sqlDirty = false;
    onDbChange();
});

querySelect.addEventListener('change', () => {
    sqlDirty = false;
    renderParams();
    generateSql();
});

showQueriesBtn.addEventListener('click', () => {
    showQueries = !showQueries;
    queryPanel.classList.toggle('display-none', !showQueries);
    showQueriesBtn.textContent = showQueries ? 'Dölj enskilda queries' : 'Visa enskilda queries';
    if (!showQueries) {
        const rec = recommendedQuery(currentDb());
        if (rec) querySelect.value = rec.id;
        sqlDirty = false;
        renderParams();
        generateSql();
    }
    renderRecommended();
});

sqlOut.addEventListener('input', () => {
    sqlDirty = true;
    plainSql = sqlOut.value;
    copyButton.disabled = !sqlOut.value;
});

editButton.addEventListener('click', () => {
    if (editing) {
        sqlDirty = false;
        setEditMode(false);
        generateSql();
    } else {
        setEditMode(true);
        sqlOut.focus();
    }
});

copyButton.addEventListener('click', async () => {
    const text = editing ? sqlOut.value : plainSql;
    try {
        await navigator.clipboard.writeText(text);
        showToast();
    } catch (e) {
        sqlOut.classList.remove('display-none');
        sqlOut.select();
        document.execCommand('copy');
        if (!editing) sqlOut.classList.add('display-none');
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
