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
        'tools/plist-viewer/plist.html': 'tools/text-formatter/formatter.html?format=plist',
    };

    const frames = new Map();

    // Extraktionen följer med mellan verktygen. Huvudfönstret minns zippen (File) som senast
    // öppnades eller stängdes i något verktyg, med ett löpnummer, och skickar läget till ett verktyg
    // när det visas. Verktyget följer bara en ändring det inte redan har sett, så att till exempel
    // testdata i Härkomst inte byts bort bara för att verktyget visas igen.
    let extraction = { file: null, seq: 0, from: '', info: null };
    // Vad ett verktyg vet om en zip (iOS- eller Android-version) kan komma före beskedet att zippen
    // öppnats, eftersom versionen läses medan zippen öppnas. Den sparas tills beskedet kommer.
    let pendingInfo = null;

    // Verktygen som visar raden högst upp (extraktionen och filen man tittar på), och deras namn i
    // meddelandena mellan verktygen.
    const CONTEXT_TOOLS = {
        'tools/provenance/index.html': 'provenance',
        'tools/db-queries/queries.html': 'queries',
        'tools/exif-viewer/index.html': 'exif',
    };
    const TOOL_PATH = { provenance: 'tools/provenance/index.html', queries: 'tools/db-queries/queries.html', exif: 'tools/exif-viewer/index.html' };
    let activePath = '';
    // Filen man senast tittade på i Härkomst eller EXIF & karta: { name, path, place, owner, from }.
    // owner är verktygets sökväg; verktyget lämnar ut filen när någon vill visa den någon annanstans.
    let current = null;

    function sameFile(a, b) {
        return !!a && !!b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
    }

    function sizeText(bytes) {
        const units = ['byte', 'kB', 'MB', 'GB', 'TB'];
        let v = bytes;
        let i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return (i ? v.toLocaleString('sv-SE', { maximumFractionDigits: 1 }) : String(v)) + ' ' + units[i];
    }

    function renderExtraction() {
        const el = document.getElementById('extraction-status');
        if (!el) return;
        const f = extraction.file;
        el.hidden = !f;
        el.textContent = f ? 'Extraktion: ' + f.name : '';
        el.title = f ? f.name + ', ' + sizeText(f.size) + (extraction.from ? '. Öppnad i ' + extraction.from : '') +
            '. Härkomst och Queries använder samma extraktion.' : '';
    }

    // force: verktyget som visas följer alltid, när undersökaren själv bytt eller stängt i raden högst upp.
    function sendExtraction(frame, force) {
        postToFrame(frame, { source: 'forensics-toolbox', type: 'extraction', file: extraction.file, seq: extraction.seq, from: extraction.from, force: !!force });
    }

    // Ny eller stängd extraktion. Laddade verktyg får läget direkt och följer efter sina egna regler;
    // verktyget som ändrade får numret tillbaka, så att det inte följer sin egen ändring.
    function setExtraction(file, from, source, force) {
        if (!(file ? sameFile(file, extraction.file) : !extraction.file)) {
            extraction = { file: file, seq: extraction.seq + 1, from: from || '', info: pendingInfo && sameFile(pendingInfo.file, file) ? pendingInfo.info : null };
            pendingInfo = null;
            if (current && current.owner === TOOL_PATH.provenance) current = null;
        }
        renderBar();
        frames.forEach((frame, path) => {
            if (!frame.dataset.ready) return;
            if (frame === source) sendExtraction(frame);
            else if (CONTEXT_TOOLS[path] && CONTEXT_TOOLS[path] !== 'exif') sendExtraction(frame, force && path === activePath);
        });
    }

    function byId(id) { return document.getElementById(id); }

    function renderBar() {
        renderExtraction();
        const bar = byId('context-bar');
        if (!bar) return;
        const kind = CONTEXT_TOOLS[activePath];
        bar.hidden = !kind;
        if (!kind) return;
        const f = extraction.file;
        byId('cb-zip').textContent = f ? f.name : 'Ingen öppen';
        byId('cb-zip').title = f ? f.name : '';
        byId('cb-zip-meta').textContent = f ? [sizeText(f.size), extraction.info && extraction.info.device].filter(Boolean).join(' · ') : '';
        // I Queries tar knappen emot både en extraktion och en databas, och Queries känner igen vilket.
        const queries = kind === 'queries';
        byId('cb-open').textContent = queries ? 'Öppna extraktion eller databas…' : f ? 'Byt…' : 'Öppna extraktion (zip)…';
        byId('cb-open').title = queries ? 'En zip öppnas som extraktion i alla verktyg. En databas, med sin -wal, öppnas i Queries.' : '';
        byId('cb-input').multiple = queries;
        if (queries) byId('cb-input').removeAttribute('accept');
        else byId('cb-input').setAttribute('accept', '.zip,application/zip');
        byId('cb-close').hidden = !f;
        const file = f ? current : null;
        byId('cb-file').hidden = !file;
        if (!file) return;
        byId('cb-file-name').textContent = file.name;
        byId('cb-file-name').title = file.path || file.name;
        byId('cb-file-meta').textContent = [file.place, file.from ? 'i ' + file.from : ''].filter(Boolean).join(' · ');
        bar.querySelectorAll('[data-to]').forEach((b) => { b.hidden = b.dataset.to === kind; });
    }

    // Öppnar ett verktyg och skickar meddelandet när ramen är laddad.
    function deliver(to, payload) {
        const path = TOOL_PATH[to];
        if (!openTool(path)) return;
        const frame = frames.get(path);
        const send = () => postToFrame(frame, payload);
        if (frame && frame.dataset.ready) send();
        else if (frame) frame.addEventListener('load', send, { once: true });
    }

    function frameOf(win) {
        for (const frame of frames.values()) {
            if (frame.contentWindow === win) return frame;
        }
        return null;
    }

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

    // Meddelanden tas bara emot från verktygens egna ramar, inte från sidor de kan ha öppnat.
    function fromToolFrame(event) {
        for (const frame of frames.values()) {
            if (frame.contentWindow && event.source === frame.contentWindow) return true;
        }
        return false;
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
            frame.dataset.ready = '1';
            postToFrame(frame, { source: 'forensics-toolbox', type: 'theme', theme: currentTheme() });
            sendExtraction(frame);
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
            if (frame.dataset.ready) sendExtraction(frame);
        }

        placeholder.style.display = 'none';
        host.hidden = false;
        showFrame(frame);
        activePath = path;
        renderBar();
        return true;
    }

    document.querySelectorAll('.nav-item[data-type="frame"]').forEach((item) => {
        item.addEventListener('click', () => {
            openTool(item.dataset.src);
        });
    });

    window.addEventListener('message', (event) => {
        if (!fromToolFrame(event)) return;
        const data = event.data;
        if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
        if (data.type === 'positions' && Array.isArray(data.points)) {
            openTool('tools/positions/index.html');
            const frame = frames.get('tools/positions/index.html');
            const send = () => postToFrame(frame, {
                source: 'forensics-toolbox', type: 'positions', points: data.points,
                layerKey: data.layerKey, layerName: data.layerName, focusExifId: data.focusExifId, noun: data.noun,
            });
            if (frame && frame.dataset.ready) send();
            else if (frame) frame.addEventListener('load', send, { once: true });
            return;
        }
        if (data.type === 'show-exif') {
            openTool('tools/exif-viewer/index.html');
            const frame = frames.get('tools/exif-viewer/index.html');
            const send = () => postToFrame(frame, { source: 'forensics-toolbox', type: 'show-exif', exifId: data.exifId });
            if (frame && frame.dataset.ready) send();
            else if (frame) frame.addEventListener('load', send, { once: true });
            return;
        }
        // Ett verktyg öppnade eller stängde en zip. Verktyget får numret tillbaka, så att det inte
        // följer sin egen ändring; de andra får läget när de visas.
        // bar: zippen valdes i raden högst upp och skickades vidare till Queries, som öppnade den.
        if (data.type === 'extraction-changed') {
            const frame = frameOf(event.source);
            setExtraction(data.file || null, frame && !data.bar ? frame.title : '', frame, false);
            return;
        }
        // Vad verktyget vet om extraktionen (iOS 26.0, Android 13), till raden högst upp.
        if (data.type === 'extraction-info') {
            if (data.file && data.info && data.info.device) {
                const info = { device: String(data.info.device) };
                if (sameFile(data.file, extraction.file)) { extraction.info = info; renderBar(); }
                else pendingInfo = { file: data.file, info: info };
            }
            return;
        }
        // Filen verktyget visar, eller name: null när den inte visas längre.
        if (data.type === 'current-file') {
            const frame = frameOf(event.source);
            const owner = frame ? frame.dataset.tool : '';
            if (data.name) {
                current = { name: String(data.name), path: data.path ? String(data.path) : '', place: data.place ? String(data.place) : '', owner: owner, from: frame ? frame.title : '' };
            } else if (current && current.owner === owner) current = null;
            renderBar();
            return;
        }
        // Filer från ett verktyg till ett annat: till EXIF & karta som filer att läsa, till Härkomst som
        // filer att leta upp i extraktionen.
        if (data.type === 'file-for' && TOOL_PATH[data.to] && Array.isArray(data.files)) {
            deliver(data.to, data.to === 'exif'
                ? { source: 'forensics-toolbox', type: 'exif-files', files: data.files, open: data.files.length === 1 }
                : { source: 'forensics-toolbox', type: 'provenance-files', files: data.files });
            return;
        }
        // Filnamn ur ett resultat i Queries, att bedöma i Härkomst.
        if (data.type === 'names-for' && data.to === 'provenance' && Array.isArray(data.names)) {
            deliver('provenance', { source: 'forensics-toolbox', type: 'provenance-names', names: data.names, zipName: data.zipName || '' });
            return;
        }
        // Härkomst → Queries: zippen (File), databasens sökväg och exakt den SQL som kördes.
        if (data.type === 'open-query' && data.file && typeof data.sql === 'string') {
            openTool('tools/db-queries/queries.html');
            const frame = frames.get('tools/db-queries/queries.html');
            const send = () => postToFrame(frame, {
                source: 'forensics-toolbox', type: 'open-query', file: data.file, path: data.path, walPath: data.walPath,
                queryId: data.queryId, title: data.title, db: data.db, sql: data.sql, from: data.from,
                timeColumns: Array.isArray(data.timeColumns) ? data.timeColumns : null,
            });
            if (frame && frame.dataset.ready) send();
            else if (frame) frame.addEventListener('load', send, { once: true });
            return;
        }
        if (data.type !== 'open-tool' || typeof data.src !== 'string') return;
        openTool(data.src);
    });

    // Raden högst upp: öppna, byta och stänga extraktionen (i Queries också öppna en databas), och
    // visa filen i ett annat verktyg.
    const bar = byId('context-bar');
    if (bar) {
        byId('cb-open').addEventListener('click', () => byId('cb-input').click());
        byId('cb-input').addEventListener('change', () => {
            const input = byId('cb-input');
            const files = Array.from(input.files || []);
            input.value = '';
            if (!files.length) return;
            // Queries avgör själv om filerna är en extraktion eller en databas med sin -wal.
            if (CONTEXT_TOOLS[activePath] === 'queries') {
                deliver('queries', { source: 'forensics-toolbox', type: 'open-files', files: files });
                return;
            }
            setExtraction(files[0], '', null, true);
        });
        byId('cb-close').addEventListener('click', () => setExtraction(null, '', null, true));
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('[data-to]');
            if (!b || !current) return;
            // Har målverktyget redan filen räcker det att visa verktyget; annars lämnar ägaren ut den.
            if (CONTEXT_TOOLS[current.owner] === b.dataset.to) { openTool(TOOL_PATH[b.dataset.to]); return; }
            postToFrame(frames.get(current.owner), { source: 'forensics-toolbox', type: 'deliver-file', to: b.dataset.to });
        });
    }

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

    function isSafeHttpUrl(href) {
        try {
            const url = new URL(href);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    function openModal(href, title) {
        if (!isSafeHttpUrl(href)) return;
        pendingHref = href;
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
            const title = link.querySelector('.nav-item-title')?.textContent.trim() || 'webbplatsen';
            openModal(link.href, title);
        });
    });

    window.addEventListener('message', (event) => {
        const fromTool = Array.from(document.querySelectorAll('iframe.tool-frame'))
            .some((frame) => frame.contentWindow === event.source);
        if (!fromTool) return;
        const data = event.data;
        if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
        if (data.type !== 'open-external' || typeof data.href !== 'string') return;
        openModal(data.href, data.title || 'webbplatsen');
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