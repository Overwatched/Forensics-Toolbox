const catalogEl = document.getElementById('tool-catalog');
const search = document.getElementById('tool-search');
const empty = document.getElementById('empty-state');

function openExternal(tool) {
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({
            source: 'forensics-toolbox',
            type: 'open-external',
            href: tool.url,
            title: tool.name,
        }, '*');
        return;
    }
    window.open(tool.url, '_blank', 'noopener,noreferrer');
}

function render(query) {
    const hits = ExternalTools.filterTools(query);
    catalogEl.innerHTML = '';
    empty.classList.toggle('display-none', hits.length > 0);

    ExternalTools.GROUPS.forEach((group) => {
        const tools = hits.filter((t) => t.group === group.id);
        if (!tools.length) return;
        const title = document.createElement('h2');
        title.className = 'group-title';
        title.textContent = group.label;
        catalogEl.appendChild(title);
        const grid = document.createElement('div');
        grid.className = 'orb-grid';
        tools.forEach((tool) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'orb-card';
            btn.title = tool.url;
            btn.innerHTML = '<span class="orb"></span><span class="orb-name"></span><span class="orb-desc"></span>';
            btn.querySelector('.orb').textContent = tool.initials;
            btn.querySelector('.orb').style.background = tool.color;
            btn.querySelector('.orb-name').textContent = tool.name;
            btn.querySelector('.orb-desc').textContent = tool.desc;
            btn.addEventListener('click', () => openExternal(tool));
            grid.appendChild(btn);
        });
        catalogEl.appendChild(grid);
    });
}

search.addEventListener('input', () => render(search.value));

window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (data && (data.source === 'forensics-toolbox' || data.source === 'verktygslada') &&
        data.type === 'theme' && (data.theme === 'light' || data.theme === 'dark')) {
        document.documentElement.setAttribute('data-theme', data.theme);
        try { localStorage.setItem('theme', data.theme); } catch (e) { /* ignoreras */ }
    }
});

render('');
search.focus();
