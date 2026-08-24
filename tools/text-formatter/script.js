const jsonInput = document.getElementById('json-input');
const jsonOutput = document.getElementById('json-output');
const jsonStatus = document.getElementById('json-status');
const pbInput = document.getElementById('pb-input');
const pbOutput = document.getElementById('pb-output');
const pbStatus = document.getElementById('pb-status');
const pbFile = document.getElementById('pb-file');
const pbFileLabel = document.getElementById('pb-file-label');
const plistInput = document.getElementById('plist-input');
const plistOutput = document.getElementById('plist-output');
const plistStatus = document.getElementById('plist-status');
const plistFile = document.getElementById('plist-file');
const plistFileLabel = document.getElementById('plist-file-label');
const magicInput = document.getElementById('magic-input');
const magicStatus = document.getElementById('magic-status');
const magicResults = document.getElementById('magic-results');
const magicSample = document.getElementById('magic-sample');
const magicFormats = document.getElementById('magic-formats');
const toast = document.getElementById('toast');

const FORMATS = ['magic', 'json', 'protobuf', 'plist'];

let format = 'magic';
let pbFileBytes = null;
let lastPbJson = '';
let plistFileBytes = null;

function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
}

function setStatus(el, text, kind) {
    el.textContent = text;
    el.style.color = kind === 'ok' ? 'var(--success)' : kind === 'err' ? 'var(--error)' : 'var(--text-muted)';
}

function selectFormat(next) {
    if (FORMATS.indexOf(next) === -1) return;
    format = next;
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.format === format);
    });
    FORMATS.forEach((id) => {
        document.getElementById('panel-' + id).classList.toggle('display-none', format !== id);
    });
}

function selectedMagicIds() {
    return [...magicFormats.querySelectorAll('input:checked')].map((el) => el.value);
}

function renderHits(hits) {
    magicResults.innerHTML = '';
    if (!hits.length) {
        magicResults.innerHTML = '<p class="hint">Inget av de ikryssade formaten passade.</p>';
        return;
    }
    hits.forEach((hit) => {
        const card = document.createElement('article');
        card.className = 'hit';
        card.innerHTML =
            '<div class="hit-head"><strong></strong><span class="hit-score"></span></div>' +
            '<p class="hit-why"></p><pre></pre><div class="button-row"></div>';
        card.querySelector('strong').textContent = hit.title;
        card.querySelector('.hit-score').textContent = hit.confidence;
        card.querySelector('.hit-why').textContent = hit.why;
        card.querySelector('pre').textContent = hit.text;
        const row = card.querySelector('.button-row');
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'Kopiera';
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(hit.text);
                showToast(hit.title + ' kopierad');
            } catch (e) {
                showToast('Kunde inte kopiera');
            }
        });
        row.appendChild(copyBtn);
        if (hit.open === 'json' || hit.open === 'protobuf' || hit.open === 'plist') {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'secondary';
            const labels = { json: 'Öppna i JSON', protobuf: 'Öppna i protobuf', plist: 'Öppna i plist' };
            openBtn.textContent = labels[hit.open];
            openBtn.addEventListener('click', () => {
                if (hit.open === 'json') {
                    jsonInput.value = hit.text;
                    jsonOutput.textContent = hit.text;
                    setStatus(jsonStatus, 'Från Magic', 'ok');
                    selectFormat('json');
                } else if (hit.open === 'plist') {
                    plistInput.value = magicInput.value;
                    plistFileBytes = null;
                    plistFile.value = '';
                    plistFileLabel.textContent = 'Eller välj .plist / bplist';
                    plistOutput.textContent = hit.text;
                    setStatus(plistStatus, 'Från Magic', 'ok');
                    selectFormat('plist');
                } else {
                    pbInput.value = magicInput.value;
                    pbOutput.textContent = hit.text;
                    lastPbJson = hit.text;
                    setStatus(pbStatus, 'Från Magic', 'ok');
                    selectFormat('protobuf');
                }
            });
            row.appendChild(openBtn);
        }
        magicResults.appendChild(card);
    });
}

async function runMagic() {
    const text = magicInput.value;
    if (!String(text || '').trim()) {
        renderHits([]);
        setStatus(magicStatus, 'Ingen indata');
        return;
    }
    const hits = await TextMagic.runMagic(text, selectedMagicIds());
    renderHits(hits);
    setStatus(magicStatus, hits.length ? hits.length + ' tolkning' + (hits.length === 1 ? '' : 'ar') : 'Ingen träff', hits.length ? 'ok' : 'err');
}

function fillSample(sample) {
    if (!sample) return;
    magicInput.value = sample.input;
    magicSample.value = sample.id;
    setStatus(magicStatus, 'Testdata: ' + sample.label + ' — ' + sample.note);
    runMagic();
}

TextMagic.FORMATS.forEach((item) => {
    const label = document.createElement('label');
    label.innerHTML = '<input type="checkbox" checked> <span></span>';
    label.querySelector('input').value = item.id;
    label.querySelector('span').textContent = item.label;
    magicFormats.appendChild(label);
});

const samplePlaceholder = document.createElement('option');
samplePlaceholder.value = '';
samplePlaceholder.textContent = 'Välj testdata…';
magicSample.appendChild(samplePlaceholder);
TextMagic.SAMPLES.forEach((sample) => {
    const opt = document.createElement('option');
    opt.value = sample.id;
    opt.textContent = sample.label;
    magicSample.appendChild(opt);
});

document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => selectFormat(tab.dataset.format));
});

document.getElementById('magic-run-button').addEventListener('click', () => runMagic());
document.getElementById('magic-clear-button').addEventListener('click', () => {
    magicInput.value = '';
    magicSample.value = '';
    magicResults.innerHTML = '';
    setStatus(magicStatus, 'Ingen indata');
});
document.getElementById('magic-fill-button').addEventListener('click', () => {
    const id = magicSample.value || 'all';
    const sample = TextMagic.SAMPLES.find((s) => s.id === id) || TextMagic.SAMPLES[0];
    fillSample(sample);
});
magicSample.addEventListener('change', () => {
    const sample = TextMagic.SAMPLES.find((s) => s.id === magicSample.value);
    if (sample) fillSample(sample);
});
magicFormats.addEventListener('change', () => {
    if (String(magicInput.value || '').trim()) runMagic();
});

document.getElementById('format-button').addEventListener('click', () => {
    try {
        jsonOutput.textContent = JSON.stringify(JSON.parse(jsonInput.value), null, 2);
        setStatus(jsonStatus, 'Giltig JSON — formatterad', 'ok');
    } catch (e) {
        jsonOutput.textContent = e.message;
        setStatus(jsonStatus, 'Ogiltig JSON', 'err');
    }
});

document.getElementById('minify-button').addEventListener('click', () => {
    try {
        jsonOutput.textContent = JSON.stringify(JSON.parse(jsonInput.value));
        setStatus(jsonStatus, 'JSON minifierad', 'ok');
    } catch (e) {
        jsonOutput.textContent = e.message;
        setStatus(jsonStatus, 'Ogiltig JSON', 'err');
    }
});

document.getElementById('validate-button').addEventListener('click', () => {
    try {
        JSON.parse(jsonInput.value);
        setStatus(jsonStatus, 'JSON är giltig', 'ok');
    } catch (e) {
        setStatus(jsonStatus, 'JSON är ogiltig', 'err');
    }
});

document.getElementById('json-fill-button').addEventListener('click', () => {
    const sample = TextMagic.SAMPLES.find((s) => s.id === 'json');
    jsonInput.value = sample.input;
    jsonOutput.textContent = JSON.stringify(JSON.parse(sample.input), null, 2);
    setStatus(jsonStatus, 'Testdata: ' + sample.note, 'ok');
});

document.getElementById('json-clear-button').addEventListener('click', () => {
    jsonInput.value = '';
    jsonOutput.textContent = 'Resultat visas här';
    setStatus(jsonStatus, 'Ingen JSON laddad');
});

document.getElementById('json-copy-button').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(jsonOutput.textContent);
        showToast('JSON kopierad');
    } catch (e) {
        showToast('Kunde inte kopiera');
    }
});

pbFile.addEventListener('change', async () => {
    const file = pbFile.files && pbFile.files[0];
    if (!file) {
        pbFileBytes = null;
        pbFileLabel.textContent = 'Eller välj en blob-fil';
        return;
    }
    pbFileBytes = new Uint8Array(await file.arrayBuffer());
    pbFileLabel.textContent = file.name + ' (' + file.size + ' byte)';
});

document.getElementById('pb-decode-button').addEventListener('click', () => {
    try {
        const result = pbFileBytes && pbFileBytes.length
            ? Object.assign(ProtobufViewer.decodeBytes(pbFileBytes), { inputKind: 'fil' })
            : ProtobufViewer.parseInputText(pbInput.value);
        lastPbJson = JSON.stringify(result.json, null, 2);
        var extra = result.lengthPrefixed ? ' Längdprefix hoppades över.' : '';
        pbOutput.textContent = result.text + '\n\n--- JSON ---\n' + lastPbJson;
        setStatus(pbStatus, 'Protobuf (' + result.inputKind + ', ' + result.bytes + ' B).' + extra, 'ok');
    } catch (e) {
        lastPbJson = '';
        pbOutput.textContent = e.message || String(e);
        setStatus(pbStatus, 'Kunde inte avkoda protobuf', 'err');
    }
});

document.getElementById('pb-fill-button').addEventListener('click', () => {
    const sample = TextMagic.SAMPLES.find((s) => s.id === 'sqlite') || TextMagic.SAMPLES.find((s) => s.id === 'protobuf');
    pbInput.value = sample.input;
    pbFileBytes = null;
    pbFile.value = '';
    pbFileLabel.textContent = 'Eller välj en blob-fil';
    document.getElementById('pb-decode-button').click();
    setStatus(pbStatus, 'Testdata: ' + sample.note, 'ok');
});

document.getElementById('pb-clear-button').addEventListener('click', () => {
    pbInput.value = '';
    pbFile.value = '';
    pbFileBytes = null;
    lastPbJson = '';
    pbFileLabel.textContent = 'Eller välj en blob-fil';
    pbOutput.textContent = 'Resultat visas här';
    setStatus(pbStatus, 'Ingen protobuf laddad');
});

document.getElementById('pb-copy-text-button').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(pbOutput.textContent);
        showToast('Text kopierad');
    } catch (e) {
        showToast('Kunde inte kopiera');
    }
});

document.getElementById('pb-copy-json-button').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(lastPbJson || pbOutput.textContent);
        showToast('JSON kopierad');
    } catch (e) {
        showToast('Kunde inte kopiera');
    }
});

jsonInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        var start = jsonInput.selectionStart;
        var end = jsonInput.selectionEnd;
        jsonInput.value = jsonInput.value.substring(0, start) + '    ' + jsonInput.value.substring(end);
        jsonInput.selectionStart = jsonInput.selectionEnd = start + 4;
    }
});

document.getElementById('plist-parse-button').addEventListener('click', () => {
    try {
        const value = plistFileBytes && plistFileBytes.length
            ? parsePlist(plistFileBytes)
            : parsePlist(plistInput.value);
        plistOutput.textContent = JSON.stringify(value, null, 2);
        const keyed = typeof isKeyedArchiver === 'function' && isKeyedArchiver(value)
            ? ' NSKeyedArchiver — titta i $objects.'
            : '';
        setStatus(plistStatus, 'Plist läst.' + keyed, 'ok');
    } catch (err) {
        plistOutput.textContent = err.message || String(err);
        setStatus(plistStatus, 'Kunde inte läsa plist', 'err');
    }
});

plistFile.addEventListener('change', async () => {
    const file = plistFile.files && plistFile.files[0];
    if (!file) {
        plistFileBytes = null;
        plistFileLabel.textContent = 'Eller välj .plist / bplist';
        return;
    }
    plistFileLabel.textContent = file.name + ' (' + file.size + ' byte)';
    plistFileBytes = new Uint8Array(await file.arrayBuffer());
});

document.getElementById('plist-fill-button').addEventListener('click', () => {
    const sample = TextMagic.SAMPLES.find((s) => s.id === 'plist');
    plistInput.value = sample.input;
    plistFileBytes = null;
    plistFile.value = '';
    plistFileLabel.textContent = 'Eller välj .plist / bplist';
    document.getElementById('plist-parse-button').click();
    setStatus(plistStatus, 'Testdata: ' + sample.note, 'ok');
});

document.getElementById('plist-clear-button').addEventListener('click', () => {
    plistInput.value = '';
    plistFile.value = '';
    plistFileBytes = null;
    plistFileLabel.textContent = 'Eller välj .plist / bplist';
    plistOutput.textContent = 'Resultat visas här';
    setStatus(plistStatus, 'Ingen plist laddad');
});

document.getElementById('plist-copy-button').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(plistOutput.textContent);
        showToast('JSON kopierad');
    } catch (e) {
        showToast('Kunde inte kopiera');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        if (format === 'json') document.getElementById('format-button').click();
        else if (format === 'protobuf') document.getElementById('pb-decode-button').click();
        else if (format === 'plist') document.getElementById('plist-parse-button').click();
        else runMagic();
    }
});

window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
    if (data.type === 'theme' && (data.theme === 'light' || data.theme === 'dark')) {
        document.documentElement.setAttribute('data-theme', data.theme);
        try { localStorage.setItem('theme', data.theme); } catch (e) { /* ignoreras */ }
        return;
    }
    if (data.type === 'select-format' && data.format) selectFormat(data.format);
});

(function initFromQuery() {
    var params = new URLSearchParams(location.search);
    var requested = params.get('format');
    if (FORMATS.indexOf(requested) !== -1) selectFormat(requested);
})();
