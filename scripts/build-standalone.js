#!/usr/bin/env node
// Bygger hela verktygslådan (utan CyberChef) som en enda html-fil:
//
//   release/ForensicsToolbox-X.Y-en-fil.html
//
// Varför: på en del hanterade Windows-datorer stoppar Edge varje file://-navigering som sidan själv
// startar (policyn IntranetFileLinksEnabled). Då kan html-versionen inte visa verktygen i sina ramar.
// Den här filen öppnar aldrig något via file://: varje verktyg ligger i sidan som text och visas i en
// srcdoc-ram när det öppnas (se FT_STANDALONE i src/script.js). Idén kommer från CryptoToolbox
// (scripts/build-standalone.js), som Toolbox bygger på.
//
// Källkoden ändras inte. Skriptet läser Toolbox.html, src/, queries/ och verktygens mappar, och:
// - lägger in verktygens css och skript i varje verktygs html;
// - lagrar filer över SHARED_BYTES (kartan, ExifTool, SQLite) en gång; huvudsidan sätter in dem i
//   verktyget när det öppnas, så att filen inte blir flera gånger så stor;
// - ger Härkomst ExifTool direkt (verktyget läser annars in det från exif-viewer när det behövs);
// - låter verktygen läsa sina parametrar och tro att de körs under file:, som i html-zippen
//   (location.search och location.protocol skrivs om till FT_SEARCH och FT_PROTOCOL);
// - stoppar om något verktyg fortfarande pekar på en lokal fil.
//
// Kör: node scripts/build-standalone.js [--out <fil>]

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const TOOLBOX_HTML = path.join(ROOT, 'Toolbox.html');
const SHARED_BYTES = 512 * 1024;
const EXCLUDE = [/^tools\/CyberChef\//i];
// Skript som ett verktyg läser in själv när det behövs (loadScript), och som därför inte står i dess html.
const HEIC = 'tools/_shared/vendor/libheif/libheif-worker.js';
const EXTRA = {
    'tools/provenance/index.html': ['tools/exif-viewer/vendor/exiftool/exiftool-worker.js', 'tools/exif-viewer/vendor/exiftool/zeroperl-wasm.js', HEIC],
    // HEIC-avkodaren (tools/_shared/heic.js) laddas när en HEIC ska visas.
    'tools/chats/index.html': [HEIC],
    'tools/exif-viewer/index.html': [HEIC],
};
const MARKER = '<script>window.FT_STANDALONE = true;</script>';

function log(msg) { console.log('build-standalone: ' + msg); }

function readShortVersion(html) {
    const m = html.match(/Version\s+(\d+)\.(\d+)\b/);
    if (!m) throw new Error('hittar inte "Version X.Y" i Toolbox.html');
    return m[1] + '.' + m[2];
}

const readText = (file) => fs.readFileSync(file, 'utf8');
// Text i ett inlagt <script> eller <style> får inte stänga det i förtid.
const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script');
const escapeStyle = (css) => css.replace(/<\/style/gi, '<\\/style');
const isLocalRef = (ref) => !!ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(ref);
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

function resolveRef(htmlFile, ref) {
    const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
    const file = path.resolve(path.dirname(htmlFile), clean);
    if (!file.startsWith(ROOT + path.sep)) return null;
    return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function getAttr(tag, name) {
    const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

// Verktygens egen kod (inte vendor) läser parametrar och protokoll ur FT_SEARCH och FT_PROTOCOL.
function rewriteLocation(code, file, stats) {
    if (/\/vendor\//.test(rel(file))) return code;
    return code.replace(/\blocation\.(search|protocol)\b/g, (all, what, at) => {
        if (code[at - 1] === '.') return all; // window.location.search lämnas åt mönstret nedan
        stats.rewritten++;
        return what === 'search' ? '(window.FT_SEARCH || location.search)' : '(window.FT_PROTOCOL || location.protocol)';
    }).replace(/\bwindow\.location\.(search|protocol)\b/g, (all, what) => {
        stats.rewritten++;
        return what === 'search' ? '(window.FT_SEARCH || window.location.search)' : '(window.FT_PROTOCOL || window.location.protocol)';
    });
}

// Ett skript eller en stilmall: stor nog att delas, eller inlagd direkt.
function scriptTag(file, attrs, stats, shared) {
    const key = rel(file);
    const size = fs.statSync(file).size;
    if (size >= SHARED_BYTES) {
        if (!shared.has(key)) shared.set(key, { kind: 'script', text: escapeScript(readText(file)) });
        stats.shared++;
        return '<script' + attrs + ' data-ft-shared="' + key + '"></script>';
    }
    stats.inlined++;
    return '<script' + attrs + '>\n' + escapeScript(rewriteLocation(readText(file), file, stats)) + '\n</script>';
}

function styleTag(file, stats, shared) {
    const key = rel(file);
    if (fs.statSync(file).size >= SHARED_BYTES) {
        if (!shared.has(key)) shared.set(key, { kind: 'style', text: escapeStyle(readText(file)) });
        stats.shared++;
        return '<style data-ft-shared="' + key + '"></style>';
    }
    stats.inlined++;
    return '<style>\n' + escapeStyle(readText(file)) + '\n</style>';
}

function inlineDocument(htmlFile, stats, shared) {
    let html = readText(htmlFile);
    html = html.replace(/<link\b[^>]*>/gi, (tag) => {
        const relAttr = (getAttr(tag, 'rel') || '').toLowerCase();
        const href = getAttr(tag, 'href');
        if (!isLocalRef(href)) return tag;
        if (relAttr === 'icon' || relAttr === 'shortcut icon') return '';
        if (relAttr !== 'stylesheet') return tag;
        const file = resolveRef(htmlFile, href);
        if (!file) { stats.missing.push(rel(htmlFile) + ' -> ' + href); return tag; }
        return styleTag(file, stats, shared);
    });
    html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
        const src = getAttr('<script ' + attrs + '>', 'src');
        if (!isLocalRef(src)) return tag;
        const file = resolveRef(htmlFile, src);
        if (!file) { stats.missing.push(rel(htmlFile) + ' -> ' + src); return tag; }
        const keep = attrs.replace(/\s(?:src|defer|async)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
        return scriptTag(file, keep, stats, shared);
    });
    // Skript i sidan själv (inte inlagda filer): samma omskrivning av location.
    html = html.replace(/<script>([\s\S]*?)<\/script>/gi, (tag, code) => /data-ft-shared/.test(tag) ? tag : '<script>' + rewriteLocation(code, htmlFile, stats) + '</script>');
    const extra = EXTRA[rel(htmlFile)] || [];
    if (extra.length) {
        const tags = extra.map((p) => scriptTag(path.join(ROOT, p), '', stats, shared)).join('\n');
        // Före sidans egen </body>, den sista: inlagda skript kan ha </body> i sina strängar.
        const at = html.toLowerCase().lastIndexOf('</body>');
        html = at >= 0 ? html.slice(0, at) + tags + '\n' + html.slice(at) : html + tags;
    }
    // Det som fortfarande pekar på en lokal fil skulle hämtas via file://.
    const left = [];
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => tag.replace(/>[\s\S]*<\/script>$/i, '></script>')).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    markup.replace(/<(?:img|script|iframe|source|video|audio|embed|link)\b[^>]*>/gi, (tag) => {
        const ref = getAttr(tag, 'src') || getAttr(tag, 'href');
        if (isLocalRef(ref) && !/^data:/i.test(ref)) left.push(ref);
        return tag;
    });
    left.forEach((ref) => stats.missing.push(rel(htmlFile) + ' pekar fortfarande på ' + ref));
    return html;
}

// JSON i <script type="application/json">: "<" skrivs som \u003c, så att html-tolken aldrig ser "</script" eller "<!--".
function jsonForScriptTag(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function main() {
    const outArg = process.argv.indexOf('--out');
    let shell = readText(TOOLBOX_HTML);
    const version = readShortVersion(shell);
    const outFile = outArg >= 0 ? path.resolve(process.argv[outArg + 1]) : path.join(RELEASE_DIR, 'ForensicsToolbox-' + version + '-en-fil.html');
    const stats = { inlined: 0, shared: 0, rewritten: 0, missing: [] };
    const shared = new Map();
    // Posterna i sidopanelen ur Toolbox.html som den står, innan skripten läggs in (de innehåller data-src i text).
    const sources = [...new Set([...shell.matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]))];

    // 1. Huvudsidans egna filer.
    shell = shell.replace(/<link\b[^>]*href="src\/style\.css"[^>]*>/i, () => '<style>\n' + escapeStyle(readText(path.join(ROOT, 'src', 'style.css'))) + '\n</style>');
    shell = shell.replace(/<script\s+src="([^"]+)"><\/script>/gi, (tag, src) => {
        const file = resolveRef(TOOLBOX_HTML, src);
        if (!file) throw new Error('huvudsidans skript ' + src + ' finns inte');
        const code = '<script>\n' + escapeScript(readText(file)) + '\n</script>';
        return src === 'src/script.js' ? MARKER + '\n' + code : code;
    });
    if (shell.split(MARKER).length !== 2) throw new Error('src/script.js hittades inte exakt en gång i Toolbox.html');

    // 2. Varje post i sidopanelen som ett eget JSON-block.
    const blocks = [];
    for (const src of sources) {
        const relSrc = src.split(/[?#]/)[0];
        if (EXCLUDE.some((re) => re.test(relSrc))) { log('hoppar över ' + relSrc); continue; }
        const file = resolveRef(TOOLBOX_HTML, relSrc);
        if (!file) throw new Error('posten ' + src + ' finns inte på disk');
        if (!/\.html?$/i.test(file)) throw new Error('vet inte hur ' + src + ' ska läggas in');
        blocks.push('<script type="application/json" data-ft-src="' + escapeAttr(relSrc) + '">' + jsonForScriptTag(inlineDocument(file, stats, shared)) + '</script>');
    }
    if (stats.missing.length) throw new Error('lokala filer som inte gick att lägga in:\n  ' + stats.missing.join('\n  '));
    for (const [key, v] of shared) blocks.push('<script type="application/json" data-ft-shared-src="' + escapeAttr(key) + '">' + jsonForScriptTag(v) + '</script>');

    // 3. Blocken före huvudsidans skript, så att de finns när src/script.js körs.
    const out = shell.replace(MARKER, () => blocks.join('\n') + '\n' + MARKER);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    if (outArg < 0 && fs.existsSync(RELEASE_DIR)) {
        for (const f of fs.readdirSync(RELEASE_DIR)) if (/^ForensicsToolbox-\d+\.\d+-en-fil\.html$/.test(f) && path.join(RELEASE_DIR, f) !== outFile) fs.unlinkSync(path.join(RELEASE_DIR, f));
    }
    fs.writeFileSync(outFile, out);
    const mb = (Buffer.byteLength(out) / (1024 * 1024)).toFixed(1);
    log('skrev ' + path.relative(ROOT, outFile) + ' (' + mb + ' MB, ' + blocks.length + ' block, ' + stats.inlined + ' filer inlagda, ' + shared.size + ' delade, ' + stats.rewritten + ' location omskrivna)');
}

main();
