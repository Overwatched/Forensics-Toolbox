const jsonInput = document.getElementById('json-input');
const jsonOutput = document.getElementById('json-output');
const jsonStatus = document.getElementById('json-status');
const pbInput = document.getElementById('pb-input');
const pbOutput = document.getElementById('pb-output');
const pbStatus = document.getElementById('pb-status');
const pbFile = document.getElementById('pb-file');
const pbFileLabel = document.getElementById('pb-file-label');
const toast = document.getElementById('toast');

let format = 'json';
let pbFileBytes = null;
let lastPbJson = '';

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
    if (next !== 'json' && next !== 'protobuf') return;
    format = next;
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.format === format);
    });
    document.getElementById('panel-json').classList.toggle('display-none', format !== 'json');
    document.getElementById('panel-protobuf').classList.toggle('display-none', format !== 'protobuf');
}

document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => selectFormat(tab.dataset.format));
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

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        if (format === 'json') document.getElementById('format-button').click();
        else document.getElementById('pb-decode-button').click();
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
    if (requested === 'json' || requested === 'protobuf') selectFormat(requested);
})();
