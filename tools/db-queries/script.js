// Inne i Forensics Toolbox öppnas extraktionen eller databasen i raden högst upp, och vissa knappar
// finns bara där.
if (window.parent !== window) document.body.classList.add('in-hub');

const paramsEl = document.getElementById('params');
const sqlOut = document.getElementById('sql-out');
const sqlView = document.getElementById('sql-view');
const metaBox = document.getElementById('meta-box');
const loadError = document.getElementById('load-error');
const copyButton = document.getElementById('copy-button');
const editButton = document.getElementById('edit-button');
const workspace = document.getElementById('workspace');
const startView = document.getElementById('start');
const toast = document.getElementById('toast');
const resultPreview = document.getElementById('result-preview');
const timePreview = document.getElementById('time-preview');
const sqlLegend = document.querySelector('.sql-legend');
const qEyebrow = document.getElementById('q-eyebrow');
const qTitle = document.getElementById('q-title');
const qBadge = document.getElementById('q-badge');
const qSub = document.getElementById('q-sub');
const sideTree = document.getElementById('side-tree');
const sideSearch = document.getElementById('side-search');
const sideHome = document.getElementById('side-home');
const sideHomeSub = document.getElementById('side-home-sub');
const dCard = document.getElementById('d-card');

const TIME_NAMES = new Set(['timeStart', 'timeEnd', 'unixStart', 'unixEnd']);
const LIST_NAMES = new Set(['filename', 'bundleId', 'packageName']);
const NUMBER_NAMES = new Set(['maxAccuracy']);
const KW_RE = /\b(WITH|RECURSIVE|SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|INNER|ON|AS|CASE|WHEN|THEN|ELSE|END|ORDER|BY|GROUP|LIMIT|LIKE|IFNULL|BETWEEN|IN|NOT|NULL|DISTINCT|UNION|ALL|DESC|ASC|PRAGMA)\b/g;

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
let sqlDirty = false;
let editing = false;
let plainSql = '';
// Den valda databasen och queryn. Utan vald query gäller den rekommenderade.
let currentDbId = '';
let currentQueryId = '';
// Det som skrivits i fälten, per namn: samma tidsspann eller filnamn följer med till nästa query.
let paramMemory = {};
// Fliken under resultatet som visas (sql, trace eller about), tom när den är ihopfälld.
let pane = 'sql';
// Sidopanelen: "Inte i extraktionen" är utfälld, databaserna som undersökaren fällt ut, om den valda
// databasen är ihopfälld, och de som fällts ihop under en sökning (töms när sökningen ändras).
let missingOpen = false;
const userOpen = new Set();
let curCollapsed = false;
const searchClosed = new Set();
// Familjen som senast var vald: när en annan väljs fälls den ut, också under "Inte i extraktionen".
let shownKey = null;

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

// source säger var databasens fil kom ifrån: { zip } ur en öppnad extraktion, { file } från disk.
// extraction beskriver zippens och filens databaser så länge något är öppet (extraction.js).
let source = null;
let extraction = null;
// Satt när SQL:en kom från Härkomst: { queryId, title, db, from }. Då visas exakt den SQL:en, utan fält.
let custom = null;

function currentDb() {
    return databases.find((d) => d.id === currentDbId) || null;
}

function recommendedQuery(db) {
    if (!db) return null;
    const list = db.queries || [];
    return list.find((q) => q.recommended) || list.find((q) => q.group !== 'advanced') || list[0] || null;
}

function currentQuery() {
    const db = currentDb();
    if (!db) return null;
    return (db.queries || []).find((q) => q.id === currentQueryId) || recommendedQuery(db);
}

// Photos.sqlite har en databas per iOS-version i samma familj; de andra är sin egen familj.
function familyKey(d) {
    return d.family || d.id;
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

// Om databasen: beskrivningen, sökvägen på telefonen, källan och noterna.
function renderMeta() {
    const db = currentDb();
    if (!db) {
        metaBox.innerHTML = '';
        return;
    }
    const paths = (db.dbPathHints && db.dbPathHints.length ? db.dbPathHints : [db.dbPathHint]).filter(Boolean);
    const src = db.source || '';
    const sourceHtml = !src ? ''
        : /^https?:\/\//.test(src)
            ? '<p><strong>Källa:</strong> <a href="' + escapeHtml(src) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(src.replace(/^https:\/\/github.com\//, '')) + '</a></p>'
            : '<p>' + escapeHtml(src) + '</p>';
    metaBox.innerHTML =
        (db.blurb ? '<p>' + escapeHtml(db.blurb) + '</p>' : '') +
        (paths.length ? '<p><strong>Sökväg:</strong> ' + paths.map((p) => '<code>' + escapeHtml(p) + '</code>').join('<br>') + '</p>' : '') +
        sourceHtml + (db.note ? '<p>' + escapeHtml(db.note) + '</p>' : '') + (db.footerHtml || '');
}

// Överst i arbetsytan: var databasen hör hemma, queryns namn och vad den gör.
function renderQueryHead() {
    const db = currentDb();
    if (!db) return;
    const cat = CATEGORIES[categoryOf(db)] || {};
    qEyebrow.textContent = [db.os, (cat.title || '') + (cat.beta ? ' (beta)' : ''),
        splitTitle(db.familyTitle || db.label).name + (db.versionLabel ? ' (' + db.versionLabel + ')' : '')].join(' · ');
    sqlLegend.classList.toggle('display-none', !!custom);
    if (custom) {
        const file = String(custom.from || '').replace(/^Härkomst · /, '');
        qTitle.textContent = custom.title || custom.queryId || '';
        qBadge.innerHTML = '<span class="badge">Från Härkomst</span>';
        qSub.innerHTML = 'Samma SQL som Härkomst körde' + (file ? ' för ' + escapeHtml(file) : '') +
            ', med tidsfönstret och värdena ifyllda (query <code>' + escapeHtml(custom.queryId || '') + '</code>).';
        return;
    }
    const q = currentQuery();
    qTitle.textContent = q ? q.title : '';
    qBadge.innerHTML = q && q.recommended ? '<span class="badge">Rekommenderas</span>' : '';
    qSub.textContent = q ? q.subtitle : '';
}

function hasTimeParams(params) {
    return (params || []).some((p) => TIME_NAMES.has(p));
}

// Från och Till utan formatet inom parentes: formatet står i fältet i stället.
function shortLabel(name, fallback) {
    return String(paramLabels[name] || fallback).replace(/\s*\(ÅÅÅÅ-MM-DD TT:MM\)\s*$/, '');
}

function paramField(name, label, placeholder, cls) {
    const id = 'param-' + name;
    return '<div class="param-block ' + cls + '">' +
        '<label class="field-label" for="' + escapeHtml(id) + '">' + escapeHtml(label) + '</label>' +
        '<input type="text" id="' + escapeHtml(id) + '" data-param="' + escapeHtml(name) + '" spellcheck="false" autocomplete="off"' +
        ' placeholder="' + escapeHtml(placeholder) + '" value="' + escapeHtml(paramMemory[name] || '') + '">' +
        '</div>';
}

// Fälten står på samma rad som Kör, och Enter kör queryn. Det som skrivits in står kvar när
// man byter query eller databas i fliken.
function renderParams() {
    const q = custom ? null : currentQuery();
    const params = (q && q.params) || [];
    const time = hasTimeParams(params);
    let html = '';
    if (time) {
        html += paramField('timeStart', shortLabel('timeStart', 'Från'), 'ÅÅÅÅ-MM-DD TT:MM', 'param-time');
        html += paramField('timeEnd', shortLabel('timeEnd', 'Till'), 'ÅÅÅÅ-MM-DD TT:MM', 'param-time');
    }
    params.filter((p) => !TIME_NAMES.has(p)).forEach((name) => {
        const placeholder = paramDefaults[name] != null ? 'Tomt = ' + paramDefaults[name] : '';
        html += paramField(name, paramLabels[name] || name, placeholder, 'param-text');
    });
    paramsEl.innerHTML = html;
    paramsEl.classList.toggle('display-none', !html);
    timePreview.classList.toggle('display-none', !time);
    paramsEl.querySelectorAll('input').forEach((input) => {
        const refresh = () => {
            paramMemory[input.getAttribute('data-param')] = input.value;
            sqlDirty = false;
            generateSql();
        };
        input.addEventListener('input', refresh);
        input.addEventListener('change', refresh);
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            document.getElementById('run-button').click();
        });
    });
}

function updateTimePreview() {
    if (timePreview.classList.contains('display-none')) return;
    const startRaw = paramValue('timeStart');
    const endRaw = paramValue('timeEnd');
    if (!startRaw && !endRaw) {
        timePreview.textContent = 'Ingen tidsgräns: hela databasen.';
        return;
    }
    const start = TimeSql.parse(startRaw, false);
    const end = TimeSql.parse(endRaw, true);
    const bad = [];
    if (startRaw && !start) bad.push('Från');
    if (endRaw && !end) bad.push('Till');
    if (bad.length) {
        timePreview.textContent = 'Ogiltigt datum i ' + bad.join(' och ')
            + '. Använd ÅÅÅÅ-MM-DD eller ÅÅÅÅ-MM-DD TT:MM, eller klistra in unixtid (10 eller 13 siffror).';
        return;
    }

    const show = (t, open) => (t ? t.text + ' (UTC' + t.offset + ')' : open);
    const typedDate = (startRaw && !looksLikeEpoch(startRaw)) || (endRaw && !looksLikeEpoch(endRaw));
    timePreview.textContent = 'Söker från ' + show(start, 'början') + ' till ' + show(end, 'slutet') + (typedDate ? ', i ' + (localZoneName() || 'datorns tidszon') : '') + '.';
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

// Innan queryn körts: påhittade rader med kolumnerna i SQL:en, tydligt märkta. Inget är läst ur någon fil,
// och rutan ska inte gå att ta för ett resultat. Knappen visas när queryn går att köra (run.js, can-run).
function renderResultPreview(sql) {
    if (!resultPreview || !window.QueryPreview) return;
    const cols = window.QueryPreview.columns(sql);
    if (!cols.length) {
        resultPreview.innerHTML = '<p class="muted">Den här queryn returnerar inga rader. Den är en mall eller arbetsgång: läs kommentarerna i SQL:en.</p>';
        return;
    }
    const db = currentDb();
    const rows = window.QueryPreview.exampleRows(cols, {
        sql: sql,
        platform: db ? db.os : '',
        filename: paramValue('filename'),
        packageName: paramValue('packageName'),
        bundleId: paramValue('bundleId'),
        rows: 3,
    });
    const geo = window.MapImport ? window.MapImport.guessColumns(cols) : null;
    resultPreview.innerHTML =
        '<div class="preview-note"><span class="preview-tag">Exempel</span>' +
        '<span class="preview-text"><strong>Queryn är inte körd.</strong> Raderna nedanför är påhittade och visar bara vilka kolumner queryn ger. Inget är läst ur databasen.' +
        (geo && geo.lat >= 0 && geo.lon >= 0 ? ' Efter körningen går resultatet att visa på karta.' : '') + '</span>' +
        '<button type="button" class="preview-run" id="preview-run">Kör query</button></div>' +
        '<div class="result-scroll preview-table" aria-label="Påhittade exempelrader"><table><thead><tr>' +
        cols.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((v) => '<td>' + escapeHtml(v) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
}

function onDbChange() {
    const db = currentDb();
    custom = null;
    document.dispatchEvent(new CustomEvent('queries:db-change'));
    workspace.classList.toggle('display-none', !db);
    startView.classList.toggle('display-none', !!db);
    sqlDirty = false;
    setEditMode(false);
    currentQueryId = db ? ((recommendedQuery(db) || {}).id || '') : '';
    renderSide();
    if (!db) {
        sqlView.innerHTML = '';
        sqlOut.value = '';
        plainSql = '';
        copyButton.disabled = true;
        return;
    }
    renderQueryHead();
    renderMeta();
    renderParams();
    generateSql();
}

// Rollqueryer (hidden) används av Härkomst och visas inte i listan.
function visibleQueries(list) {
    return (list || []).filter((q) => !q.hidden);
}

function buildDatabases(photos, android, appUsage, routined, snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, telegramIos, samsungAndroid) {
    routined = routined || {};
    samsungAndroid = samsungAndroid || {};
    snapchat = snapchat || {};
    snapchatAndroid = snapchatAndroid || {};
    signalAndroid = signalAndroid || {};
    signalIos = signalIos || {};
    whatsappIos = whatsappIos || {};
    telegramIos = telegramIos || {};
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
        snapchatAndroid.paramLabels || {},
        signalAndroid.paramLabels || {},
        signalIos.paramLabels || {},
        whatsappIos.paramLabels || {},
        telegramIos.paramLabels || {},
        samsungAndroid.paramLabels || {}
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
            footerHtml: db.id === 'knowledgec'
                ? '<p>Biome <code>App.InFocus</code> är SEGB/protobuf, inte SQL — använd iLEAPP.</p>'
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

    // Signal (beta): databaserna är krypterade med SQLCipher. Programmet letar efter nyckeln under extra/ i
    // zippen och bredvid zippen (ExtractionCore.findKeys). Annars väljs filen eller klistras nyckeln in.
    // WhatsApp (beta) på iOS är okrypterad. Telegram (beta) på iOS lagrar i ett eget format, som
    // avkodas i minnet när databasen öppnas (postbox.js, derive).
    [[signalAndroid, 'Android', 'signal'], [signalIos, 'iOS', 'signal'], [whatsappIos, 'iOS', 'whatsapp'], [telegramIos, 'iOS', 'telegram']].forEach(([cat, os, category]) => {
        (cat.databases || []).forEach((db) => {
            const label = db.label.replace(/^(Android|iOS) — /, '');
            out.push({
                id: db.id,
                os: os,
                category: category,
                family: db.id,
                familyTitle: label,
                label: label + ' (beta)',
                blurb: db.blurb || '',
                dbPathHint: db.dbPathHint,
                paths: db.paths || [],
                source: db.source,
                note: cat.sourceNote,
                cipher: db.cipher || null,
                derive: db.derive || null,
                runnable: true,
                queries: visibleQueries(db.queries).map((q) => ({
                    id: q.id,
                    title: q.title,
                    subtitle: q.subtitle || '',
                    recommended: !!q.recommended,
                    group: q.group,
                    returns: q.returns || '',
                    params: q.params || [],
                    sql: q.sql,
                    chat: q.chat || null,
                })),
            });
        });
    });

    // Samsungs textfiler (eRR.p): filen tolkas som i Härkomst och läses in som en tabell i minnet (text-logs.js, convert).
    (samsungAndroid.databases || []).forEach((db) => {
        out.push({
            id: db.id,
            os: 'Android',
            category: 'samsung',
            family: db.id,
            familyTitle: db.label,
            label: db.label,
            blurb: db.blurb || '',
            dbPathHint: db.dbPathHint,
            paths: db.paths || [],
            source: db.source,
            note: samsungAndroid.sourceNote,
            convert: db.convert || null,
            runnable: true,
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
    samsung: {
        title: 'Samsung',
        intro: {
            Android: 'Samsungs egna textfiler, inlästa som tabeller i minnet med samma tolkning som i Härkomst: eRR.p med telefonens starter och nedstängningar.',
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
    signal: {
        title: 'Signal',
        beta: true,
        intro: {
            Android: 'Signals egna databaser under data/data/org.thoughtcrime.securesms: meddelanden, bilagor med SHA-256, kontakter och Signals logg. Krypterade med SQLCipher; nyckeln läses ur extraktionen eller klistras in.',
            iOS: 'Signals databas i appgruppen: meddelanden, bilagor med SHA-256, samtal och kontakter. Krypterad med SQLCipher. Programmet letar efter nyckelringen under extra/ i zippen och bredvid zippen. Annars väljs den med Nyckelfil…, eller så klistras nyckeln in.',
        },
    },
    whatsapp: {
        title: 'WhatsApp',
        beta: true,
        intro: {
            iOS: 'WhatsApps databas i appgruppen: meddelanden, mediefiler med bildbibliotekets id, chattar och samtal.',
        },
    },
    telegram: {
        title: 'Telegram',
        beta: true,
        intro: {
            iOS: 'Telegrams databaser i appgruppen: meddelanden, samtal, kontakter och chattar, och lagringsdatabasen som kopplar filerna till chattar, meddelanden och bildbiblioteket. Telegrams eget format avkodas i minnet.',
        },
    },
};
const CATEGORY_ORDER = ['system', 'samsung', 'snapchat', 'signal', 'whatsapp', 'telegram'];

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

// Katalogens databaser per familj: { os, category, title, blurb, items: [databaser] }.
function catalogFamilies() {
    const families = [];
    const byKey = {};
    databases.forEach((d) => {
        const key = familyKey(d);
        if (!byKey[key]) {
            byKey[key] = {
                key: key,
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

// opts.source: var filen kommer ifrån. opts.keepQuery: queryn som visas står kvar om den finns i
// databasen (samma fil med en annan iOS-version, eller en fil som öppnas medan queryn visas).
function selectDb(id, opts) {
    if (!id || !databases.some((d) => d.id === id)) return;
    const keep = opts && opts.keepQuery && !custom ? currentQueryId : '';
    source = (opts && opts.source) || null;
    currentDbId = id;
    sqlDirty = false;
    onDbChange();
    if (keep && keep !== currentQueryId && (currentDb().queries || []).some((q) => q.id === keep)) selectQuery(keep);
    window.scrollTo(0, 0);
}

// En annan query i samma databas: filerna och den inlästa databasen står kvar.
function selectQuery(id) {
    const db = currentDb();
    if (!db || !(db.queries || []).some((q) => q.id === id)) return;
    custom = null;
    currentQueryId = id;
    sqlDirty = false;
    setEditMode(false);
    document.dispatchEvent(new CustomEvent('queries:query-change'));
    renderQueryHead();
    renderParams();
    generateSql();
    renderSide();
}

function goHome() {
    source = null;
    currentDbId = '';
    sqlDirty = false;
    onDbChange();
}

// Databasen ur zippen eller filen från disk när den finns där, annars katalogens databas utan fil.
function pickFamily(key, dbId) {
    if (extraction && extraction.covers(key)) extraction.pick(key, dbId);
    else selectDb(dbId);
}

// Klick på en query. Är databasen redan vald byts bara queryn, utom när databasen visas utan fil
// och filen nu finns i zippen eller på disk: då hämtas den därifrån.
function pickQuery(key, dbId, queryId) {
    const cur = currentDb();
    const covered = !!extraction && extraction.covers(key);
    if (!cur || familyKey(cur) !== key || (!source && covered)) pickFamily(key, dbId);
    selectQuery(queryId);
}

// Klick på databasens rad fäller ut eller ihop dess queries, också den valda databasens. Det som
// visas till höger ändras inte.
function isFamilyOpen(key, searching) {
    if (searching) return !searchClosed.has(key);
    const cur = currentDb();
    return userOpen.has(key) || (!!cur && familyKey(cur) === key && !curCollapsed);
}

function toggleFamily(key) {
    const searching = !!sideSearch.value.trim();
    const open = isFamilyOpen(key, searching);
    if (searching) {
        if (open) searchClosed.add(key);
        else searchClosed.delete(key);
    } else {
        const cur = currentDb();
        const isCur = !!cur && familyKey(cur) === key;
        if (open) userOpen.delete(key);
        else userOpen.add(key);
        if (isCur) curCollapsed = open;
    }
    renderSide();
}

// Photos.sqlite: en annan iOS-version byter katalogens databas men behåller filen (ur zippen eller
// från disk) och queryn.
function pickVersion(dbId) {
    const cur = currentDb();
    if (!cur || cur.id === dbId) return;
    const keep = custom ? '' : currentQueryId;
    if (source && extraction) extraction.repick(dbId);
    else selectDb(dbId);
    if (keep) selectQuery(keep);
}

// "cache_controller.db (Snapchat cache)": namnet, och det inom parentes som visas grått.
function splitTitle(title) {
    const m = /^(.*?)\s*\(([^()]*)\)$/.exec(String(title || ''));
    return m ? { name: m[1], sub: m[2] } : { name: String(title || ''), sub: '' };
}

const CHEVRON = '<svg class="side-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
    '<path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function queryMatches(q, terms) {
    const hay = (q.title + ' ' + (q.subtitle || '') + ' ' + (q.returns || '')).toLowerCase();
    return terms.every((t) => hay.includes(t));
}

// Sidopanelen: databaserna per operativsystem och kategori. Ett klick på en databas fäller ut eller
// ihop dess queries, och den valda databasen fälls ut när den väljs. Med en extraktion eller en fil
// öppen står deras databaser först och de andra under "Inte i extraktionen" (eller "Andra
// databaser"). En sökning fäller ut alla databaser med träffar.
function renderSide() {
    const cur = currentDb();
    const curKey = cur ? familyKey(cur) : null;
    const active = cur && !custom ? currentQuery() : null;
    const terms = sideSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const split = !!extraction && extraction.families.size > 0;
    const fresh = curKey !== shownKey;
    if (fresh) {
        shownKey = curKey;
        curCollapsed = false;
    }

    sideHome.classList.toggle('active', !cur);
    if (cur) sideHome.removeAttribute('aria-current');
    else sideHome.setAttribute('aria-current', 'page');
    sideHomeSub.textContent = extraction ? extraction.title : 'Inget öppet';

    const found = [];
    const missing = [];
    catalogFamilies().forEach((f) => {
        const isCur = f.key === curKey;
        const covered = !!extraction && extraction.covers(f.key);
        const db = isCur ? cur : (covered && extraction.dbFor(f.key)) || f.items[f.items.length - 1];
        let queries = db.queries || [];
        if (terms.length) {
            const famHit = terms.every((t) => f.title.toLowerCase().includes(t));
            if (!famHit) queries = queries.filter((q) => queryMatches(q, terms));
            if (!famHit && !queries.length) return;
        }
        const row = { f: f, db: db, queries: queries, open: isFamilyOpen(f.key, terms.length > 0), isCur: isCur };
        (split && !extraction.families.has(f.key) ? missing : found).push(row);
    });
    if (fresh && missing.some((r) => r.isCur)) missingOpen = true;

    let html = sideSections(found, active);
    if (missing.length) {
        const open = terms.length > 0 || missingOpen;
        html += '<details class="side-missing"' + (open ? ' open' : '') + '><summary>' + escapeHtml(extraction.missingLabel) + ' <span class="side-count">' +
            missing.length + '</span></summary>' + sideSections(missing, active) + '</details>';
    }
    // Panelen ritas om vid varje klick: knappen som hade fokus får det tillbaka, så att man kan
    // fortsätta med tangentbordet.
    const had = sideTree.contains(document.activeElement) ? sideKey(document.activeElement) : null;
    sideTree.innerHTML = html || '<p class="side-empty">Inga queries matchar.</p>';
    if (had) {
        const again = [...sideTree.querySelectorAll('button')].find((b) => sideKey(b) === had);
        if (again) again.focus();
    }
}

function sideKey(el) {
    return ['data-ver', 'data-q', 'data-family'].map((a) => el.getAttribute(a) || '').join('|');
}

function sideSections(rows, active) {
    const groups = groupByOsAndCategory(rows.map((r) => ({ os: r.f.os, category: r.f.category, row: r })));
    let html = '';
    Object.keys(groups).forEach((os) => {
        groups[os].forEach((g) => {
            const cat = CATEGORIES[g.key] || {};
            const intro = cat.intro && cat.intro[os] ? cat.intro[os] : '';
            html += '<div class="side-sec"><div class="side-head" title="' + escapeHtml(intro) + '">' + escapeHtml(os + ' · ' + (cat.title || g.key)) +
                (cat.beta ? ' <span class="side-beta">beta</span>' : '') + '</div>';
            g.items.forEach((x) => { html += sideFamily(x.row, active); });
            html += '</div>';
        });
    });
    return html;
}

function sideFamily(r, active) {
    const t = splitTitle(r.f.title);
    let html = '<div class="side-fam' + (r.isCur ? ' current' : '') + '">' +
        '<button type="button" class="side-db" data-family="' + escapeHtml(r.f.key) + '" data-db="' + escapeHtml(r.db.id) + '"' +
        ' aria-expanded="' + r.open + '" title="' + escapeHtml(r.f.blurb || r.f.title) + '">' + CHEVRON +
        '<span class="side-name">' + escapeHtml(t.name) + '</span>' +
        (t.sub ? '<span class="side-sub">' + escapeHtml(t.sub) + '</span>' : '') +
        '<span class="side-count">' + (r.db.queries || []).length + '</span></button>';
    if (!r.open) return html + '</div>';
    if (r.isCur && r.f.items.length > 1) {
        html += '<div class="side-vers" role="group" aria-label="iOS-version"><span>iOS</span>' + r.f.items.map((d) => {
            const on = d.id === r.db.id;
            return '<button type="button" class="side-ver' + (on ? ' active' : '') + '" data-ver="' + escapeHtml(d.id) + '" aria-pressed="' + on + '"' +
                ' title="' + escapeHtml(d.versionLabel || d.label) + '">' +
                escapeHtml(String(d.versionLabel || d.label).replace(/^iOS\s*/, '').replace(/ och senare$/, '+')) + '</button>';
        }).join('') + '</div>';
    }
    html += '<ul class="side-qs">' + r.queries.map((q) => {
        const on = !!active && r.isCur && q.id === active.id;
        return '<li><button type="button" class="side-q' + (on ? ' active' : '') + (q.group === 'advanced' ? ' help' : '') + '"' +
            ' data-family="' + escapeHtml(r.f.key) + '" data-db="' + escapeHtml(r.db.id) + '" data-q="' + escapeHtml(q.id) + '"' +
            (on ? ' aria-current="true"' : '') + ' title="' + escapeHtml(q.subtitle || q.title) + '">' +
            '<span class="side-q-title">' + escapeHtml(q.title) + '</span>' +
            (q.recommended ? '<span class="side-rec" title="Rekommenderas" aria-label="Rekommenderas">★</span>' : '') +
            '</button></li>';
    }).join('') + '</ul>';
    return html + '</div>';
}

// Flikarna under resultatet. Ett klick på den öppna fliken fäller ihop rutan.
function setPane(p) {
    pane = p;
    dCard.classList.toggle('collapsed', !p);
    dCard.querySelectorAll('.d-tab').forEach((b) => {
        b.setAttribute('aria-selected', b.getAttribute('data-pane') === p ? 'true' : 'false');
    });
    ['sql', 'trace', 'about'].forEach((k) => {
        document.getElementById('pane-' + k).classList.toggle('display-none', k !== p);
    });
    document.getElementById('sql-tools').classList.toggle('display-none', p !== 'sql');
}

function applyDeepLink() {
    const params = new URLSearchParams(location.search);
    let id = params.get('db') || '';
    if (ALIASES[id]) id = ALIASES[id];
    if (id && databases.some((d) => d.id === id)) selectDb(id);
}

async function init() {
    try {
        const [photos, android, appUsage, routined, snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, telegramIos, samsungAndroid] = await Promise.all([
            loadLocalJson('../../queries/ios/photos-sqlite/catalog.json', 'PHOTOS_SQLITE_CATALOG'),
            loadLocalJson('../../queries/android/catalog.json', 'ANDROID_QUERIES_CATALOG'),
            loadLocalJson('../../queries/app-usage/catalog.json', 'APP_USAGE_CATALOG'),
            loadLocalJson('../../queries/ios/routined/catalog.json', 'ROUTINED_CATALOG'),
            loadLocalJson('../../queries/ios/snapchat/catalog.json', 'SNAPCHAT_CATALOG'),
            loadLocalJson('../../queries/android/snapchat/catalog.json', 'SNAPCHAT_ANDROID_CATALOG'),
            loadLocalJson('../../queries/android/signal/catalog.json', 'SIGNAL_ANDROID_CATALOG'),
            loadLocalJson('../../queries/ios/signal/catalog.json', 'SIGNAL_IOS_CATALOG'),
            loadLocalJson('../../queries/ios/whatsapp/catalog.json', 'WHATSAPP_IOS_CATALOG'),
            loadLocalJson('../../queries/ios/telegram/catalog.json', 'TELEGRAM_IOS_CATALOG'),
            loadLocalJson('../../queries/android/samsung/catalog.json', 'SAMSUNG_ANDROID_CATALOG'),
        ]);
        databases = buildDatabases(photos, android, appUsage, routined, snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, telegramIos, samsungAndroid);
        renderSide();
        applyDeepLink();
        readyResolve();
    } catch (err) {
        loadError.textContent = 'Kunde inte ladda query-katalogerna';
        loadError.classList.remove('display-none');
        console.error(err);
    }
}

sideTree.addEventListener('click', (e) => {
    // Rubriken "Inte i extraktionen": klicket fäller ut eller ihop, och läget sparas till nästa gång panelen ritas.
    const summary = e.target.closest('.side-missing > summary');
    if (summary) {
        missingOpen = !summary.parentElement.open;
        return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-ver')) pickVersion(b.getAttribute('data-ver'));
    else if (b.hasAttribute('data-q')) pickQuery(b.getAttribute('data-family'), b.getAttribute('data-db'), b.getAttribute('data-q'));
    else if (b.hasAttribute('data-family')) toggleFamily(b.getAttribute('data-family'));
});
sideSearch.addEventListener('input', () => {
    searchClosed.clear();
    renderSide();
});
sideSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sideSearch.value) return;
    sideSearch.value = '';
    renderSide();
});
sideHome.addEventListener('click', goHome);

dCard.querySelector('.d-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.d-tab');
    if (!b) return;
    const p = b.getAttribute('data-pane');
    setPane(p === pane ? '' : p);
});
// Knappar på andra ställen (statusraden) som öppnar en flik under resultatet.
document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-show-pane]');
    if (!b) return;
    setPane(b.getAttribute('data-show-pane'));
    dCard.scrollIntoView({ block: 'nearest' });
});
// Körningen öppnar Spårbarhet när CRC32 inte stämmer.
document.addEventListener('queries:show-pane', (e) => setPane(e.detail));

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
    // Extraktionen i programmet: zippen som senast öppnades eller stängdes i något verktyg.
    if (data.type === 'extraction' && window.QueriesExtraction) {
        window.QueriesApp.ready.then(function () {
            return window.QueriesExtraction.follow({ file: data.file || null, seq: Number(data.seq) || 0, from: data.from || '', force: !!data.force });
        }).catch(function (err) { console.warn('Extraktionen kunde inte öppnas', err); });
        return;
    }
    // Nyckelfiler som valts och följer extraktionen.
    if (data.type === 'extraction-keys' && Array.isArray(data.files) && window.QueriesExtraction) {
        ready.then(() => window.QueriesExtraction.useKeyFiles(data.files, false, data.file))
            .catch((err) => console.warn('Nyckelfilerna kunde inte läsas', err));
        return;
    }
    // Knappen i raden högst upp: en zip eller en databas, som extraction.js känner igen.
    if (data.type === 'open-files' && Array.isArray(data.files) && window.QueriesExtraction) {
        ready.then(() => window.QueriesExtraction.openPicked(data.files))
            .catch((err) => console.warn('Filerna kunde inte öppnas', err));
        return;
    }
    if (data.type === 'select-db' && data.db && databases.length) {
        let id = String(data.db);
        if (ALIASES[id]) id = ALIASES[id];
        selectDb(id);
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
    renderQueryHead();
    renderParams();
    renderResultPreview(sql);
    renderSide();
    document.dispatchEvent(new CustomEvent('queries:query-change'));
}

// Flikarna: läget i arbetsytan sparas när man byter flik och läggs tillbaka när man kommer tillbaka.
// Sökningen i sidopanelen gäller alla flikar.
function snapshot() {
    return {
        dbId: currentDbId, source: source, queryId: currentQueryId, params: Object.assign({}, paramMemory), pane: pane,
        editing: editing, sqlDirty: sqlDirty, sqlText: editing ? sqlOut.value : plainSql, custom: custom, scrollY: window.scrollY,
    };
}

function restore(snap) {
    const s = snap || {};
    source = s.source || null;
    currentDbId = s.dbId && databases.some((d) => d.id === s.dbId) ? s.dbId : '';
    paramMemory = Object.assign({}, s.params || {});
    sqlDirty = false;
    setPane(s.pane != null ? s.pane : 'sql');
    onDbChange();
    if (!currentDbId) return;
    if (s.custom) {
        showCustom(s.custom, s.sqlText || '');
        if (s.editing) setEditMode(true);
        return;
    }
    if (s.queryId) selectQuery(s.queryId);
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
    if (!db) return { title: 'Översikt', sub: '' };
    let q = '';
    if (s.custom) q = s.custom.title || s.custom.queryId || '';
    else {
        const list = db.queries || [];
        const picked = list.find((x) => x.id === s.queryId) || recommendedQuery(db);
        q = picked ? picked.title : '';
    }
    return { title: db.familyTitle || db.label, sub: q, fromProvenance: !!s.custom };
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
    // { families: Set, missingLabel, title, covers(family), dbFor(family), pick(family, dbId), repick(dbId) }
    // när en extraktion eller en fil från disk är öppen, annars null. Källan ändras av extraction.js.
    setExtraction: (ex) => {
        extraction = ex;
        renderSide();
    },
    source: () => source,
    fromExtraction: () => !!(source && source.zip),
};

init();
