const textInput = document.getElementById('text-input');
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const output = document.getElementById('output');
const status = document.getElementById('status');
const toast = document.getElementById('toast');
const pastePanel = document.getElementById('paste-panel');
const filePanel = document.getElementById('file-panel');

let mode = 'paste';
let fileBytes = null;

function showToast(text) {
    toast.textContent = text || 'Kopierat';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
}

function setSuccess(text) {
    status.textContent = text;
    status.style.color = 'var(--success)';
}

function setError(text) {
    status.textContent = text;
    status.style.color = 'var(--error)';
}

document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        mode = tab.dataset.mode;
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        pastePanel.classList.toggle('display-none', mode !== 'paste');
        filePanel.classList.toggle('display-none', mode !== 'file');
    });
});

fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
        fileBytes = null;
        fileLabel.textContent = 'Välj .plist / bplist eller dra hit';
        return;
    }
    fileLabel.textContent = file.name + ' (' + file.size + ' byte)';
    fileBytes = new Uint8Array(await file.arrayBuffer());
});

document.getElementById('parse-button').addEventListener('click', () => {
    try {
        const value = mode === 'file'
            ? parsePlist(fileBytes || new Uint8Array())
            : parsePlist(textInput.value);
        output.textContent = JSON.stringify(value, null, 2);
        const keyed = isKeyedArchiver(value) ? ' NSKeyedArchiver — titta i $objects.' : '';
        setSuccess('Plist läst.' + keyed);
    } catch (err) {
        output.textContent = err.message || String(err);
        setError('Kunde inte läsa plist');
    }
});

document.getElementById('clear-button').addEventListener('click', () => {
    textInput.value = '';
    fileInput.value = '';
    fileBytes = null;
    fileLabel.textContent = 'Välj .plist / bplist eller dra hit';
    output.textContent = 'Resultat visas här';
    status.textContent = 'Ingen plist laddad';
    status.style.color = 'var(--text-muted)';
});

document.getElementById('copy-button').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(output.textContent);
        showToast('JSON kopierad');
    } catch (e) {
        showToast('Kunde inte kopiera');
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
