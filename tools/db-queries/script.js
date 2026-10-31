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
const dbOverview = document.getElementById('db-overview');
const workspace = document.getElementById('workspace');
const toast = document.getElementById('toast');
const resultPreview = document.getElementById('result-preview');
const sqlStepLabel = document.getElementById('sql-step-label');
const dbPicker = document.getElementById('db-picker');
const backBtn = document.getElementById('back-btn');

const TIME_NAMES = new Set(['timeStart', 'timeEnd', 'unixStart', 'unixEnd']);
const LIST_NAMES = new Set(['filename', 'bundleId', 'packageName']);
const NUMBER_NAMES = new Set(['maxAccuracy']);
const KW_RE = /\b(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|INNER|ON|AS|CASE|WHEN|THEN|ELSE|END|ORDER|BY|GROUP|LIMIT|LIKE|IFNULL|BETWEEN|IN|NOT|NULL|DISTINCT|UNION|ALL|DESC|ASC|PRAGMA)\b/g;

const ALIASES = {
    photos: 'photos-ios17-plus',
    'photos-sqlite': 'photos-ios17-plus',
    ios: 'photos-ios17-plus',
    'photos-ios10-12': 'photos-ios10-13',
    'photos-ios13-14': 'photos-ios14',
    android: 'android-mediastore',
    mediastore: 'android-mediastore',
    'app-usage': 'knowledgec',
    'android-wellbeing': 'wellbeing',
    routined: 'routined-cache',
    'cache-sqlite': 'routined-cache',
};

let databases = [];
let paramLabels = {};
let paramDefaults = {};
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

// Satt när databasen kom ur en öppnad extraktion: första steget i "Så här gör du" byts ut,
// och startsidans kort visar vad som finns i extraktionen.
let source = null;
let extraction = null;
// Satt när SQL:en kom från Härkomst: { queryId, title, db, from }. Då visas exakt den SQL:en, utan fält.
let custom = null;

function currentDb() {
    return databases.find((d) => d.id === dbSelect.value) || null;
}

function recommendedQuery(db) {
    if (!db) return null;
    const list = db.queries || [];
    return list.find((q) => q.recommended) || list.find((q) => q.group !== 'advanced') || list[0] || null;
}

function currentQuery() {
    const db = currentDb();
    if (!db) return null;
    if (!showQueries) return recommendedQuery(db);
    return (db.queries || []).find((q) => q.id === querySelect.value) || db.queries[0];
}

function looksLikeEpoch(raw) {
    const t = String(raw || '').trim();
    return /^\d{10}$/.test(t) || /^\d{13}$/.test(t);
}

// Inmatade datum tolkas av `new Date()` i maskinens lokala tidszon. Det måste framgå,
// annars blir tidsspannet fel mot en databas som lagrar UTC.
function localZoneName() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
        return '';
    }
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

const SQL_TOKEN_RE = new RegExp(
    "(--[^\\n]*)|('(?:[^']|'')*')|(\\u0001U\\d+\\u0001)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_]\\w*)(?=\\s*\\()|" +
    KW_RE.source, 'gi');
const KW_EXACT = new RegExp('^' + KW_RE.source + '$', 'i');

function colorSql(text) {
    let out = '';
    let last = 0;
    text.replace(SQL_TOKEN_RE, (m, comment, str, hole, num, fn, kw, offset) => {
        out += escapeHtml(text.slice(last, offset));
        last = offset + m.length;
        if (hole) out += m;
        else if (comment) out += '<span class="sql-comment">' + escapeHtml(m) + '</span>';
        else if (str) out += '<span class="sql-str">' + escapeHtml(m) + '</span>';
        else if (num) out += '<span class="sql-num">' + m + '</span>';
        else if (fn && !KW_EXACT.test(fn)) out += '<span class="sql-fn">' + escapeHtml(m) + '</span>';
        else out += '<span class="sql-kw">' + escapeHtml(m) + '</span>';
        return m;
    });
    return out + escapeHtml(text.slice(last));
}

function highlightSql(formatted, parts) {
    let html = colorSql(formatted);
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
    // Tomt fält ska träffa allt. LIKE '%…%' söker efter tecknet … och ger inga rader.
    const values = (terms.length ? terms : ['']).map((t) => t.replace(/'/g, "''"));

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

// Tiderna skrivs som datum med zon i SQL:en (se time-sql.js), inte som sekunder.
function fillTimePlaceholders(sql, parts) {
    const start = TimeSql.parse(paramValue('timeStart'), false);
    const end = TimeSql.parse(paramValue('timeEnd'), true);
    const startLit = TimeSql.literal(start, false);
    const endLit = TimeSql.literal(end, true);

    const pairs = [
        ['{{cocoaStart}}', TimeSql.expr('cocoa', startLit), !!start],
        ['{{cocoaEnd}}', TimeSql.expr('cocoa', endLit), !!end],
        ['{{unixStart}}', TimeSql.expr('unix', startLit), !!start],
        ['{{unixEnd}}', TimeSql.expr('unix', endLit), !!end],
        ['{{unixMsStart}}', TimeSql.expr('unixMs', startLit), !!start],
        ['{{unixMsEnd}}', TimeSql.expr('unixMs', endLit), !!end],
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
            // Talfält hamnar utan citattecken i SQL:en, så bara siffror släpps igenom.
            if (NUMBER_NAMES.has(name)) v = /^\d+(\.\d+)?$/.test(raw.replace(',', '.')) ? raw.replace(',', '.') : '';
            const user = !!v;
            if (!v && paramDefaults[name] != null) v = String(paramDefaults[name]);
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
        (db.blurb ? escapeHtml(db.blurb) + '<br>' : '') +
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
    let steps = db.flow || [
        'Läs in databasen + <code>-wal</code> + <code>-shm</code>',
        'Använd den rekommenderade queryn, eller välj en annan',
        'Fyll i värden (tid, filnamn, app)',
        'Kör queryn här med databasen och <code>-wal</code>, eller kopiera SQL:en till DB Browser',
    ];
    if (source) steps = [source.html].concat(steps.slice(1));
    if (custom) {
        steps = [source ? source.html : 'Databasen kommer ur extraktionen',
            'SQL:en kommer från Härkomst med tidsfönster och värden ifyllda. Inga fält att fylla i',
            'Raderna visas under <em>Kör i appen</em>, med tiden i UTC bredvid varje tidskolumn',
            'Ändra med <em>Redigera SQL</em> och kör igen, eller spara som CSV med SQL och hashar överst'];
    }
    flowBox.innerHTML = '<h2>Så här gör du</h2><ol class="flow-steps">' +
        steps.map((s) => '<li><span>' + s + '</span></li>').join('') + '</ol>' +
        (db.footerHtml || '');
}

function renderRecommended() {
    const q = currentQuery();
    recommendedBox.classList.toggle('display-none', !q);
    if (!q) return;
    const badge = q.recommended
        ? '<span class="badge">Rekommenderas</span>'
        : (q.group === 'advanced' ? '<span class="badge muted">Hjälp</span>' : '');
    recommendedBox.innerHTML =
        '<div class="q-title">' + badge + '<span>' + escapeHtml(q.title) + '</span></div>' +
        (q.subtitle ? '<div class="q-sub"><strong>Vad den gör:</strong> ' + escapeHtml(q.subtitle) + '</div>' : '') +
        (q.returns ? '<div class="q-sub"><strong>Visar:</strong> ' + escapeHtml(q.returns) + '</div>' : '');
}

function fillQuerySelect() {
    const db = currentDb();
    querySelect.innerHTML = (db.queries || []).map((q) => {
        const prefix = q.recommended ? '★ ' : '';
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
            <input type="text" id="param-timeStart" spellcheck="false" autocomplete="off" placeholder="Tomt = från början">
          </div>
          <div class="param-block">
            <label class="field-label" for="param-timeEnd">${escapeHtml(paramLabels.timeEnd || 'Till (ÅÅÅÅ-MM-DD TT:MM)')}</label>
            <input type="text" id="param-timeEnd" spellcheck="false" autocomplete="off" placeholder="Tomt = till slutet">
          </div>`;
        html += '</div><p class="zone-note">Tidszon: ' + escapeHtml(localZoneName() || 'datorns tid') + '</p>';
        html += '<div id="time-preview" class="time-preview"></div>';
        step += 1;
    }
    if (other.length) {
        html += '<div class="step-label">' + step + '. Sökvärde</div>';
        html += other.map((name) => `
          <div class="param-block">
            <label class="field-label" for="param-${escapeHtml(name)}">${escapeHtml(paramLabels[name] || name)}</label>
            <input type="text" id="param-${escapeHtml(name)}" data-param="${escapeHtml(name)}"
              spellcheck="false" autocomplete="off" placeholder="${escapeHtml(paramDefaults[name] != null
                ? 'Tomt = ' + paramDefaults[name] : (paramLabels[name] || name))}">
          </div>`).join('');
        step += 1;
    }

    paramsEl.innerHTML = html;
    if (sqlStepLabel) sqlStepLabel.textContent = step + '. SQL';
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
    const start = TimeSql.parse(startRaw, false);
    const end = TimeSql.parse(endRaw, true);
    const bad = [];
    if (startRaw && !start) bad.push('Från');
    if (endRaw && !end) bad.push('Till');
    if (bad.length) {
        el.textContent = 'Ogiltigt datum i ' + bad.join(' och ')
            + '. Använd ÅÅÅÅ-MM-DD eller ÅÅÅÅ-MM-DD TT:MM, eller klistra in unixtid (10 eller 13 siffror).';
        return;
    }

    const show = (t, open) => (t ? t.text + ' (UTC' + t.offset + ')' : open);
    let text = 'Söker från ' + show(start, 'början') + ' till ' + show(end, 'slutet') + '.';
    const typedDate = (startRaw && !looksLikeEpoch(startRaw)) || (endRaw && !looksLikeEpoch(endRaw));
    if (typedDate) {
        text += ' Datum tolkas i din tidszon (' + (localZoneName() || 'datorns tid')
            + '). Ett datum utan klockslag tar med hela dagen. Unixtid räknas som UTC.';
    }
    el.textContent = text;
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
    renderResultPreview(built.plain);
    updateTimePreview();
    if (!editing) setEditMode(false);
}

function renderResultPreview(sql) {
    if (!resultPreview || !window.QueryPreview) return;
    const cols = window.QueryPreview.columns(sql);
    if (!cols.length) {
        resultPreview.innerHTML = '<p class="muted">Det här är ingen query som returnerar rader, bara en mall eller arbetsgång. Läs kommentarerna i SQL:en.</p>';
        return;
    }
    const db = currentDb();
    const rows = window.QueryPreview.exampleRows(cols, {
        sql: sql,
        platform: db ? db.os : '',
        filename: paramValue('filename'),
        packageName: paramValue('packageName'),
        bundleId: paramValue('bundleId'),
        rows: 10,
    });
    resultPreview.innerHTML =
        '<p class="muted">Påhittade exempelrader. Kolumnerna kommer från SQL:en.</p>' +
        '<div class="result-scroll"><table><thead><tr>' +
        cols.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((v) => '<td>' + escapeHtml(v) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
}

function onDbChange() {
    const db = currentDb();
    custom = null;
    showQueriesBtn.classList.remove('display-none');
    document.querySelector('.sql-legend').classList.remove('display-none');
    document.dispatchEvent(new CustomEvent('queries:db-change'));
    workspace.classList.toggle('display-none', !db);
    if (dbOverview) dbOverview.classList.toggle('display-none', !!db);
    dbPicker.classList.toggle('display-none', !db);
    showQueries = false;
    sqlDirty = false;
    setEditMode(false);
    queryPanel.classList.add('display-none');
    showQueriesBtn.textContent = 'Välj en annan query…';
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

// Rollqueryer (hidden) används av Härkomst och visas inte i listan.
function visibleQueries(list) {
    return (list || []).filter((q) => !q.hidden);
}

function buildDatabases(photos, android, appUsage, routined, snapchat, snapchatAndroid) {
    routined = routined || {};
    snapchat = snapchat || {};
    snapchatAndroid = snapchatAndroid || {};
    const out = [];
    paramLabels = Object.assign(
        {
            timeStart: 'Från (ÅÅÅÅ-MM-DD TT:MM)',
            timeEnd: 'Till (ÅÅÅÅ-MM-DD TT:MM)',
        },
        photos.paramLabels || {},
        android.paramLabels || {},
        appUsage.paramLabels || {},
        routined.paramLabels || {},
        snapchat.paramLabels || {},
        snapchatAndroid.paramLabels || {}
    );
    paramDefaults = Object.assign({}, routined.paramDefaults || {});

    (photos.bands || []).forEach((band) => {
        const sqlById = {};
        (band.queries || []).forEach((q) => { sqlById[q.id] = q.sql; });
        const queries = (photos.questions || []).filter((q) => {
            if (q.hidden) return false;
            if (q.onlyBands && !q.onlyBands.includes(band.id)) return false;
            return !!sqlById[q.id];
        }).map((q) => ({
            id: q.id,
            title: q.label,
            subtitle: q.subtitle || '',
            recommended: !!q.recommended,
            params: q.params || [],
            group: q.group,
            returns: q.returns || '',
            sql: sqlById[q.id],
        }));
        out.push({
            id: 'photos-' + band.id,
            os: 'iOS',
            family: 'photos',
            familyTitle: 'Photos.sqlite',
            versionLabel: band.label,
            label: 'Photos.sqlite (' + band.label + ')',
            blurb: 'Fotobiblioteket: filnamn, tider, vilken app som skapade eller redigerade bilden, kamera, position och personer.',
            dbPathHint: photos.dbPathHint,
            paths: photos.paths || [],
            ios: band.ios || null,
            source: photos.source,
            note: [band.notes, photos.timeNote].filter(Boolean).join(' '),
            flow: [
                'Läs in <code>Photos.sqlite</code> + <code>-wal</code> + <code>-shm</code>',
                'Använd den rekommenderade queryn, eller välj en annan',
                'Ange filnamn, tidsspann eller app',
                'Kör queryn här med databasen och <code>-wal</code>, eller kopiera SQL:en till DB Browser',
            ],
            queries: queries,
        });
    });

    const APP_USAGE_BLURB = {
        knowledgec: 'App i användning och i förgrund, plus skärm tänd och låst/olåst. Kolla om en app var aktiv vid en tidpunkt.',
        interactionc: 'Interaktioner med personer (samtal, meddelanden, Siri-förslag) och vilken app som användes.',
        wellbeing: 'App i förgrund (ACTIVITY_RESUMED) med tidsstämpel. Digital Wellbeing / UsageEvents.',
    };
    const ANDROID_BLURB = {
        mediastore: 'Bilder och video på delad lagring: sökväg, MIME, datetaken, ägar-app (owner_package_name).',
        camera: 'Media under DCIM/Camera och filer ägda av kameraappar. Komplement till MediaStore.',
        usage: 'UsageStats är oftast XML, inte SQL. Här finns mallar och ALEAPP-tips.',
    };

    (appUsage.databases || []).forEach((db) => {
        out.push({
            id: db.id,
            os: /android|wellbeing/i.test(db.label) ? 'Android' : 'iOS',
            family: db.id,
            familyTitle: db.label.replace(/^iOS — /, '').replace(/^Android — /, ''),
            label: db.label.replace(/^iOS — /, '').replace(/^Android — /, ''),
            blurb: APP_USAGE_BLURB[db.id] || '',
            dbPathHint: db.dbPathHint,
            paths: db.paths || [],
            source: db.source,
            note: appUsage.sourceNote,
            flow: [
                'Läs in databasen + <code>-wal</code> + <code>-shm</code>',
                'Använd den rekommenderade queryn, eller välj en annan',
                'Ange tidsspann som <code>ÅÅÅÅ-MM-DD TT:MM</code>',
                'Kör queryn här med databasen och <code>-wal</code>, eller kopiera SQL:en till DB Browser',
            ],
            footerHtml: db.id === 'knowledgec'
                ? '<p style="margin-top:8px">Biome <code>App.InFocus</code> är SEGB/protobuf, inte SQL — använd iLEAPP.</p>'
                : '',
            queries: visibleQueries(db.queries).map((q) => ({
                id: q.id,
                title: q.title,
                subtitle: q.subtitle || '',
                recommended: !!q.recommended,
                group: q.group,
                returns: q.returns || '',
                params: q.params || [],
                sql: q.sql,
            })),
        });
    });

    (routined.databases || []).forEach((db) => {
        const label = db.label.replace(/^iOS — /, '');
        out.push({
            id: db.id,
            os: 'iOS',
            family: db.id,
            familyTitle: label,
            label: label,
            blurb: db.blurb || '',
            dbPathHint: db.dbPathHint,
            paths: db.paths || [],
            source: db.source,
            note: routined.sourceNote,
            runnable: true,
            flow: [
                'Välj databasen och dess <code>-wal</code> under <em>Kör i appen</em>, eller kör SQL:en i DB Browser',
                'Använd den rekommenderade queryn, eller välj en annan',
                'Ange tidsspann som <code>ÅÅÅÅ-MM-DD TT:MM</code>',
                'Visa resultatet på kartan i Positioner',
            ],
            queries: visibleQueries(db.queries).map((q) => ({
                id: q.id,
                title: q.title,
                subtitle: q.subtitle || '',
                recommended: !!q.recommended,
                group: q.group,
                returns: q.returns || '',
                params: q.params || [],
                sql: q.sql,
            })),
        });
    });

    // Snapchat (beta): på iOS hittas databaserna på suffix i appens behållare, på Android under
    // data/data/com.snapchat.android. Båda körs med -wal som de andra.
    [[snapchat, 'iOS'], [snapchatAndroid, 'Android']].forEach(([cat, os]) => {
        (cat.databases || []).forEach((db) => {
            const label = db.label.replace(/^(iOS|Android) — /, '');
            out.push({
                id: db.id,
                os: os,
                category: 'snapchat',
                family: db.id,
                familyTitle: label,
                label: label + ' (beta)',
                blurb: db.blurb || '',
                dbPathHint: db.dbPathHint,
                paths: db.paths || [],
                source: db.source,
                note: cat.sourceNote,
                runnable: true,
                flow: [
                    'Öppna extraktionen, eller välj databasen och dess <code>-wal</code> under <em>Kör i appen</em>',
                    'Använd den rekommenderade queryn, eller välj en annan',
                    'Ange tidsspann som <code>ÅÅÅÅ-MM-DD TT:MM</code>, eller cachenyckeln (filnamnet i ' + (os === 'iOS' ? 'file_manager' : 'native_content_manager') + '-mappen)',
                    'Jämför med Härkomst: samma SQL ligger i protokollets bilaga',
                ],
                queries: visibleQueries(db.queries).map((q) => ({
                    id: q.id,
                    title: q.title,
                    subtitle: q.subtitle || '',
                    recommended: !!q.recommended,
                    group: q.group,
                    returns: q.returns || '',
                    params: q.params || [],
                    sql: q.sql,
                })),
            });
        });
    });

    (android.categories || []).forEach((cat) => {
        const queries = visibleQueries(cat.queries).map((q) => ({
            id: q.id,
            title: q.title,
            subtitle: q.description || '',
            recommended: !!q.recommended,
            group: q.group,
            returns: q.returns || '',
            params: q.params || [],
            sql: q.sql,
        }));
        out.push({
            id: 'android-' + cat.id,
            os: 'Android',
            family: 'android-' + cat.id,
            familyTitle: cat.label + (cat.id === 'mediastore' ? ' (external.db)' : ''),
            label: cat.label + (cat.id === 'mediastore' ? ' (external.db)' : ''),
            blurb: ANDROID_BLURB[cat.id] || '',
            dbPathHint: (cat.dbPathHints && cat.dbPathHints[0]) || '',
            dbPathHints: cat.dbPathHints,
            paths: cat.paths || [],
            source: android.source,
            note: android.sourceNote,
            flow: [
                'Läs in databasen + <code>-wal</code> + <code>-shm</code>',
                'Använd den rekommenderade queryn, eller välj en annan',
                'Fyll i filnamn / tid / paket om queryn frågar efter det',
                'Kör queryn här med databasen och <code>-wal</code>, eller kopiera SQL:en till DB Browser',
            ],
            queries: queries,
        });
    });

    const order = [
        'photos-ios10-13', 'photos-ios14', 'photos-ios15-16', 'photos-ios17-plus',
        'routined-cache', 'knowledgec', 'interactionc',
        'snapchat-cache', 'snapchat-arroyo', 'snapchat-friends', 'snapchat-notifications',
        'android-mediastore', 'android-camera', 'wellbeing', 'android-usage',
        'snapchat-android-cache', 'snapchat-android-arroyo', 'snapchat-android-memories', 'snapchat-android-journal', 'snapchat-android-friends', 'snapchat-android-notifications',
    ];
    out.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return out;
}

// Underrubrikerna under iOS och Android: operativsystemets egna databaser först, sedan apparna.
const CATEGORIES = {
    system: {
        title: 'Operativsystemet',
        intro: {
            iOS: 'Apples egna databaser: fotobiblioteket, appanvändning, interaktioner och platser.',
            Android: 'Androids egna databaser: MediaStore, kamerans filer och appanvändning.',
        },
    },
    snapchat: {
        title: 'Snapchat',
        beta: true,
        intro: {
            iOS: 'Snapchats egna databaser i appens behållare: cache, meddelanden, vänner och notiser.',
            Android: 'Snapchats egna databaser under data/data/com.snapchat.android: cache, meddelanden, Memories, filhanterare, vänner och notiser.',
        },
    },
};
const CATEGORY_ORDER = ['system', 'snapchat'];

function categoryOf(d) {
    return d.category || 'system';
}

// { os: [{ key, items: [...] }] } i ordningen iOS, Android och kategorierna i CATEGORY_ORDER.
function groupByOsAndCategory(list) {
    const out = { iOS: [], Android: [] };
    list.forEach((d) => {
        const groups = out[d.os] || (out[d.os] = []);
        const key = categoryOf(d);
        let g = groups.find((x) => x.key === key);
        if (!g) groups.push(g = { key: key, items: [] });
        g.items.push(d);
    });
    Object.keys(out).forEach((os) => out[os].sort((a, b) => CATEGORY_ORDER.indexOf(a.key) - CATEGORY_ORDER.indexOf(b.key)));
    return out;
}

function categoryTitle(key) {
    const c = CATEGORIES[key];
    return c ? c.title + (c.beta ? ' (beta)' : '') : key;
}

function fillDbSelect() {
    const groups = groupByOsAndCategory(databases);
    let html = '<option value="">Välj databas…</option>';
    Object.keys(groups).forEach((os) => {
        groups[os].forEach((g) => {
            html += '<optgroup label="' + escapeHtml(os + ' · ' + categoryTitle(g.key)) + '">';
            g.items.forEach((d) => {
                html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.label) + '</option>';
            });
            html += '</optgroup>';
        });
    });
    dbSelect.innerHTML = html;
    dbSelect.disabled = false;
}

function overviewFamilies() {
    const families = [];
    const byKey = {};
    databases.forEach((d) => {
        const key = d.family || d.id;
        if (!byKey[key]) {
            byKey[key] = {
                os: d.os,
                category: categoryOf(d),
                title: d.familyTitle || d.label,
                blurb: d.blurb || '',
                items: [],
            };
            families.push(byKey[key]);
        }
        byKey[key].items.push(d);
    });
    return families;
}

function selectDb(id, opts) {
    if (!id || !databases.some((d) => d.id === id)) return;
    source = (opts && opts.source) || null;
    dbSelect.value = id;
    sqlDirty = false;
    onDbChange();
    window.scrollTo(0, 0);
}

const OS_INTRO = {
    iOS: 'iPhone och iPad. Tiderna i databaserna räknas från 2001 och konverteras i SQL:en.',
    Android: 'Telefoner och surfplattor. MediaStore finns på alla, de andra beror på tillverkare och version.',
};

function renderOverview() {
    if (!dbOverview) return;
    const families = overviewFamilies();
    const groups = groupByOsAndCategory(families);

    let html = '<div class="db-sections">';
    Object.keys(groups).forEach((os) => {
        if (!groups[os].length) return;
        html += '<section class="db-section"><div class="db-section-head"><h2>' + escapeHtml(os) + '</h2>' +
            '<p>' + escapeHtml(OS_INTRO[os] || '') + '</p></div>';
        groups[os].forEach((g) => {
            const cat = CATEGORIES[g.key] || {};
            html += '<div class="db-subhead"><h3>' + escapeHtml(cat.title || g.key) + (cat.beta ? ' <span class="badge muted">Beta</span>' : '') + '</h3>' +
                (cat.intro && cat.intro[os] ? '<p>' + escapeHtml(cat.intro[os]) + '</p>' : '') + '</div>';
            g.items.forEach((f) => {
                const defaultDb = f.items[f.items.length - 1];
                const rec = recommendedQuery(defaultDb);
                const path = String(defaultDb.dbPathHint || '').replace(/\s*\(.*\)\s*$/, '');
                const count = defaultDb.queries.length;
                const key = defaultDb.family || defaultDb.id;
                const found = extraction && extraction.families.has(key);
                const state = extraction ? (found ? ' db-card-found' : ' db-card-missing') : '';
                html += '<div class="db-card' + state + '" role="button" tabindex="0" data-db="' + escapeHtml(defaultDb.id) +
                    '" data-family="' + escapeHtml(key) + '">';
                if (extraction) {
                    html += '<div class="db-card-ex">' + (found
                        ? '<span class="badge">I extraktionen</span>'
                        : '<span class="db-card-ex-missing">Finns inte i extraktionen</span>') + '</div>';
                }
                html += '<div class="db-card-title"><span>' + escapeHtml(f.title) + '</span>' +
                    '<span class="db-card-count">' + count + (count === 1 ? ' query' : ' queries') + '</span></div>';
                html += '<div class="db-card-blurb">' + escapeHtml(f.blurb) + '</div>';
                if (path) html += '<div class="db-card-path" title="' + escapeHtml(path) + '">' + escapeHtml(path) + '</div>';
                if (rec) html += '<div class="db-card-rec"><span class="badge">Rekommenderas</span>' + escapeHtml(rec.title) + '</div>';
                if (f.items.length > 1) {
                    html += '<div class="db-card-versions"><span class="db-card-versions-label">iOS-version:</span>';
                    f.items.forEach((item) => {
                        html += '<button type="button" class="db-chip" data-db="' + escapeHtml(item.id) + '">' +
                            escapeHtml(item.versionLabel || item.label) + '</button>';
                    });
                    html += '</div>';
                }
                html += '</div>';
            });
        });
        html += '</section>';
    });
    dbOverview.innerHTML = html + '</div>';

    dbOverview.querySelectorAll('.db-chip').forEach((chip) => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            selectDb(chip.getAttribute('data-db'));
        });
    });
    dbOverview.querySelectorAll('.db-card').forEach((card) => {
        const pick = () => {
            const family = card.getAttribute('data-family');
            if (extraction && extraction.families.has(family)) extraction.pick(family);
            else selectDb(card.getAttribute('data-db'));
        };
        card.addEventListener('click', pick);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
            }
        });
    });
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
        const [photos, android, appUsage, routined, snapchat, snapchatAndroid] = await Promise.all([
            loadLocalJson('../../queries/ios/photos-sqlite/catalog.json', 'PHOTOS_SQLITE_CATALOG'),
            loadLocalJson('../../queries/android/catalog.json', 'ANDROID_QUERIES_CATALOG'),
            loadLocalJson('../../queries/app-usage/catalog.json', 'APP_USAGE_CATALOG'),
            loadLocalJson('../../queries/ios/routined/catalog.json', 'ROUTINED_CATALOG'),
            loadLocalJson('../../queries/ios/snapchat/catalog.json', 'SNAPCHAT_CATALOG'),
            loadLocalJson('../../queries/android/snapchat/catalog.json', 'SNAPCHAT_ANDROID_CATALOG'),
        ]);
        databases = buildDatabases(photos, android, appUsage, routined, snapchat, snapchatAndroid);
        fillDbSelect();
        renderOverview();
        applyDeepLink();
        readyResolve();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda query-katalogerna';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

dbSelect.addEventListener('change', () => {
    source = null;
    sqlDirty = false;
    onDbChange();
});

backBtn.addEventListener('click', () => {
    source = null;
    dbSelect.value = '';
    sqlDirty = false;
    onDbChange();
});

querySelect.addEventListener('change', () => {
    sqlDirty = false;
    document.dispatchEvent(new CustomEvent('queries:query-change'));
    renderRecommended();
    renderParams();
    generateSql();
});

showQueriesBtn.addEventListener('click', () => {
    showQueries = !showQueries;
    queryPanel.classList.toggle('display-none', !showQueries);
    showQueriesBtn.textContent = showQueries ? 'Använd rekommenderad query' : 'Välj en annan query…';
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
    if (custom) {
        // Härkomsts SQL finns inte i katalogen: färgningen görs om ur det som står i rutan.
        setEditMode(!editing);
        if (!editing) sqlView.innerHTML = colorSql(sqlOut.value);
        else sqlOut.focus();
        return;
    }
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
    if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
    if (data.type === 'open-query' && data.file && window.QueriesTabs) {
        window.QueriesTabs.openFromProvenance(data);
        return;
    }
    if (data.type === 'select-db' && data.db && databases.length) {
        let id = String(data.db);
        if (ALIASES[id]) id = ALIASES[id];
        if (databases.some((d) => d.id === id)) {
            source = null;
            dbSelect.value = id;
            sqlDirty = false;
            onDbChange();
        }
    }
});

// Exakt den SQL Härkomst körde, med värdena ifyllda. Fälten döljs, eftersom värdena redan står i SQL:en.
function showCustom(info, sql) {
    custom = Object.assign({}, info);
    sqlDirty = true;
    plainSql = sql;
    sqlOut.value = sql;
    sqlView.innerHTML = colorSql(sql);
    setEditMode(false);
    copyButton.disabled = !sql;
    paramsEl.innerHTML = '';
    if (sqlStepLabel) sqlStepLabel.textContent = '3. SQL';
    showQueries = false;
    queryPanel.classList.add('display-none');
    showQueriesBtn.classList.add('display-none');
    recommendedBox.classList.remove('display-none');
    recommendedBox.innerHTML =
        '<div class="q-title"><span class="badge">Från Härkomst</span><span>' + escapeHtml(custom.title || custom.queryId || '') + '</span></div>' +
        '<div class="q-sub"><strong>Query:</strong> <code>' + escapeHtml(custom.queryId || '') + '</code>' + (custom.db ? ' mot ' + escapeHtml(custom.db) : '') + '</div>' +
        '<div class="q-sub">Samma SQL som Härkomst körde, med tidsfönster och värden ifyllda. Den står också i protokollets bilaga. ' +
        'Resultatet nedan är databasen med <code>-wal</code> pålagd, precis som i Härkomst.</div>' +
        (custom.from ? '<div class="q-sub"><strong>Bedömningen:</strong> ' + escapeHtml(custom.from) + '</div>' : '');
    renderResultPreview(sql);
    renderFlow();
    document.querySelector('.sql-legend').classList.add('display-none');
    document.dispatchEvent(new CustomEvent('queries:query-change'));
}

// Flikarna: läget i arbetsytan sparas när man byter flik och läggs tillbaka när man kommer tillbaka.
function snapshot() {
    const params = {};
    paramsEl.querySelectorAll('input').forEach((el) => { params[el.id] = el.value; });
    return {
        dbId: dbSelect.value, source: source, showQueries: showQueries, queryId: querySelect.value, params: params,
        editing: editing, sqlDirty: sqlDirty, sqlText: editing ? sqlOut.value : plainSql, custom: custom, scrollY: window.scrollY,
    };
}

function restore(snap) {
    const s = snap || {};
    source = s.source || null;
    dbSelect.value = s.dbId && databases.some((d) => d.id === s.dbId) ? s.dbId : '';
    sqlDirty = false;
    onDbChange();
    if (!dbSelect.value) return;
    if (s.custom) {
        showCustom(s.custom, s.sqlText || '');
        if (s.editing) setEditMode(true);
        return;
    }
    if (s.showQueries) {
        showQueries = true;
        queryPanel.classList.remove('display-none');
        showQueriesBtn.textContent = 'Använd rekommenderad query';
        if (s.queryId) querySelect.value = s.queryId;
        renderRecommended();
        renderParams();
    }
    Object.keys(s.params || {}).forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = s.params[id];
    });
    generateSql();
    if (s.sqlDirty) {
        sqlDirty = true;
        plainSql = s.sqlText;
        sqlOut.value = s.sqlText;
        copyButton.disabled = !s.sqlText;
        setEditMode(true);
    }
}

// Kortnamnet på fliken: databasen och queryn.
function tabLabel(snap) {
    const s = snap || snapshot();
    const db = databases.find((d) => d.id === s.dbId);
    if (!db) return { title: 'Startsidan', sub: '' };
    let q = null;
    if (s.custom) q = s.custom.queryId;
    else {
        const list = db.queries || [];
        const picked = s.showQueries ? list.find((x) => x.id === s.queryId) : recommendedQuery(db);
        q = picked ? picked.title : '';
    }
    return { title: db.familyTitle || db.label, sub: q || '', fromProvenance: !!s.custom };
}

let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

window.QueriesApp = {
    ready: ready,
    currentSql: () => (editing ? sqlOut.value : plainSql),
    currentDb: currentDb,
    currentQuery: () => (custom ? { id: custom.queryId, title: custom.title } : currentQuery()),
    showCustom: showCustom,
    timeColumns: () => (custom && custom.timeColumns) || null,
    snapshot: snapshot,
    restore: restore,
    tabLabel: tabLabel,
    databases: () => databases,
    selectDb: selectDb,
    // { families: Set, pick(family) } när en extraktion är öppen, annars null.
    setExtraction: (ex) => {
        extraction = ex;
        if (!ex) source = null;
        renderOverview();
    },
    fromExtraction: () => !!source,
};

init();
