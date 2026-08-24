function updateNetStatus() {
    const el = document.getElementById('net-status');
    const text = document.getElementById('net-status-text');
    if (!el || !text) return;

    if (navigator.onLine) {
        text.textContent = 'Online';
        el.classList.remove('offline');
        el.classList.add('online');
    } else {
        text.textContent = 'Offline';
        el.classList.remove('online');
        el.classList.add('offline');
    }
}

window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);
updateNetStatus();

function initToolNav() {
    const host = document.getElementById('tool-host');
    const placeholder = document.getElementById('content-placeholder');
    if (!host || !placeholder) return;

    const toolAliases = {
        'tools/photos-sqlite-queries/queries.html': 'tools/db-queries/queries.html?db=photos-ios17-plus',
        'tools/android-queries/queries.html': 'tools/db-queries/queries.html?db=android-mediastore',
        'tools/app-usage-queries/queries.html': 'tools/db-queries/queries.html?db=knowledgec',
        'tools/JSON-formatter/JSON.html': 'tools/text-formatter/formatter.html?format=json',
    };

    const frames = new Map();

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    }

    function postToFrame(frame, payload) {
        if (!frame || !frame.contentWindow) return;
        try {
            frame.contentWindow.postMessage(payload, '*');
        } catch (e) {
            /* iframe inte redo */
        }
    }

    function broadcastTheme(theme) {
        const payload = { source: 'forensics-toolbox', type: 'theme', theme: theme };
        frames.forEach((frame) => postToFrame(frame, payload));
    }

    function showFrame(frame) {
        host.querySelectorAll('.tool-frame').forEach((el) => {
            el.classList.toggle('is-active', el === frame);
        });
    }

    function createFrame(path, src, title) {
        const frame = document.createElement('iframe');
        frame.className = 'tool-frame';
        frame.title = title || 'Verktyg';
        frame.setAttribute('data-tool', path);
        const theme = currentTheme();
        const separator = src.indexOf('?') === -1 ? '?' : '&';
        frame.src = src + separator + 'theme=' + theme;
        frame.addEventListener('load', () => {
            postToFrame(frame, { source: 'forensics-toolbox', type: 'theme', theme: currentTheme() });
        });
        host.appendChild(frame);
        frames.set(path, frame);
        return frame;
    }

    function openTool(src) {
        const pathOnly = String(src || '').split('?')[0];
        if (toolAliases[pathOnly] && String(src).indexOf('db=') === -1 && String(src).indexOf('format=') === -1) {
            src = toolAliases[pathOnly];
        }
        const path = String(src).split('?')[0];
        const item = document.querySelector(`.nav-item[data-type="frame"][data-src="${src}"]`)
            || document.querySelector(`.nav-item[data-type="frame"][data-src="${path}"]`);
        if (!item) return false;

        document.querySelectorAll('.nav-item.active').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');

        const title = item.querySelector('.nav-item-title');
        const extra = new URLSearchParams(String(src).split('?')[1] || '');
        extra.delete('theme');
        const extraQs = extra.toString();
        const loadSrc = extraQs ? path + '?' + extraQs : path;

        let frame = frames.get(path);
        if (!frame) {
            frame = createFrame(path, loadSrc, title ? title.textContent.trim() : 'Verktyg');
        } else {
            const db = extra.get('db');
            if (db) {
                postToFrame(frame, { source: 'forensics-toolbox', type: 'select-db', db: db });
            }
            const format = extra.get('format');
            if (format) {
                postToFrame(frame, { source: 'forensics-toolbox', type: 'select-format', format: format });
            }
        }

        placeholder.style.display = 'none';
        host.hidden = false;
        showFrame(frame);
        return true;
    }

    document.querySelectorAll('.nav-item[data-type="frame"]').forEach((item) => {
        item.addEventListener('click', () => {
            openTool(item.dataset.src);
        });
    });

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
        if (data.type !== 'open-tool' || typeof data.src !== 'string') return;
        openTool(data.src);
    });

    window.__toolboxBroadcastTheme = broadcastTheme;
    window.__toolboxOpenTool = openTool;
}

initToolNav();

function initSidebarToggle() {
    const app = document.querySelector('.app');
    const toggle = document.getElementById('sidebar-toggle');
    if (!app || !toggle) return;

    toggle.addEventListener('click', () => {
        app.classList.toggle('sidebar-collapsed');
    });
}

initSidebarToggle();

function initThemeToggle() {
    const THEME_KEY = 'theme';
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    function getStoredTheme() {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            return (saved === 'light' || saved === 'dark') ? saved : 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    function setStoredTheme(value) {
        try {
            localStorage.setItem(THEME_KEY, value);
        } catch (e) {
            /* localStorage otillgängligt (t.ex. privat läge) — temat gäller ändå för sessionen */
        }
    }

    function broadcastTheme(value) {
        if (typeof window.__toolboxBroadcastTheme === 'function') {
            window.__toolboxBroadcastTheme(value);
        }
    }

    function applyTheme(value) {
        document.documentElement.setAttribute('data-theme', value);
        toggle.setAttribute('aria-checked', value === 'light' ? 'true' : 'false');
    }

    let theme = getStoredTheme();
    applyTheme(theme);

    toggle.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        applyTheme(theme);
        setStoredTheme(theme);
        broadcastTheme(theme);
    });

}

initThemeToggle();

function initDownloadConfirm() {
    const modal = document.getElementById('download-modal');
    const text = document.getElementById('download-modal-text');
    const cancelButton = document.getElementById('download-modal-cancel');
    const confirmButton = document.getElementById('download-modal-confirm');
    if (!modal || !text || !cancelButton || !confirmButton) return;

    let pendingHref = null;

    function openModal(link) {
        pendingHref = link.href;
        const title = link.querySelector('.nav-item-title')?.textContent.trim() || 'filen';
        text.textContent = `Vill du ladda ner "${title}" som .zip-fil från GitHub?`;
        modal.classList.remove('display-none');
    }

    function closeModal() {
        modal.classList.add('display-none');
        pendingHref = null;
    }

    document.querySelectorAll('.nav-item--download').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            openModal(link);
        });
    });

    cancelButton.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('display-none')) closeModal();
    });

    confirmButton.addEventListener('click', () => {
        if (pendingHref) {
            const link = document.createElement('a');
            link.href = pendingHref;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }
        closeModal();
    });
}

initDownloadConfirm();

function initExternalLinkConfirm() {
    const modal = document.getElementById('external-link-modal');
    const text = document.getElementById('external-link-modal-text');
    const cancelButton = document.getElementById('external-link-modal-cancel');
    const confirmButton = document.getElementById('external-link-modal-confirm');
    if (!modal || !text || !cancelButton || !confirmButton) return;

    let pendingHref = null;

    function openModal(link) {
        pendingHref = link.href;
        const title = link.querySelector('.nav-item-title')?.textContent.trim() || 'webbplatsen';
        text.textContent = `Vill du lämna Forensics Toolbox och öppna "${title}" i ny flik?`;
        modal.classList.remove('display-none');
    }

    function closeModal() {
        modal.classList.add('display-none');
        pendingHref = null;
    }

    document.querySelectorAll('.nav-item--link').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            openModal(link);
        });
    });

    cancelButton.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('display-none')) closeModal();
    });

    confirmButton.addEventListener('click', () => {
        if (pendingHref) {
            window.open(pendingHref, '_blank', 'noopener,noreferrer');
        }
        closeModal();
    });
}

initExternalLinkConfirm();