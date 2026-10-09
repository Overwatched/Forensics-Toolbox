(function () {
    'use strict';

    var catalogEl = document.getElementById('app-catalog');
    var search = document.getElementById('app-search');
    var category = document.getElementById('app-category');
    var exportButton = document.getElementById('export-csv');
    var empty = document.getElementById('empty-state');
    var toast = document.getElementById('toast');
    var toastTimer = null;
    var visible = [];

    var allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'Alla typer';
    category.append(allOption);
    AppIds.GROUPS.forEach(function (group) {
        var option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.label;
        category.append(option);
    });

    function showToast(text) {
        toast.textContent = text;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1400);
    }

    function copyText(value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(function () { showToast('Kopierat'); });
            return;
        }
        showToast('Kunde inte kopiera');
    }

    function openExternal(url, title) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                source: 'forensics-toolbox',
                type: 'open-external',
                href: url,
                title: title,
            }, '*');
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function platformBlock(label, idValue, storeUrl, storeLabel) {
        var box = document.createElement('div');
        box.className = 'platform';
        var heading = document.createElement('h3');
        heading.textContent = label;
        box.append(heading);
        if (!idValue) {
            var missing = document.createElement('p');
            missing.className = 'missing';
            missing.textContent = 'Inte i katalogen';
            box.append(missing);
            return box;
        }
        var row = document.createElement('div');
        row.className = 'id-row';
        var code = document.createElement('code');
        code.textContent = idValue;
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Kopiera';
        copy.addEventListener('click', function () { copyText(idValue); });
        row.append(code, copy);
        box.append(row);
        if (storeUrl) {
            var actions = document.createElement('div');
            actions.className = 'actions';
            var link = document.createElement('button');
            link.type = 'button';
            link.className = 'link-btn';
            link.textContent = storeLabel;
            link.addEventListener('click', function () { openExternal(storeUrl, storeLabel); });
            actions.append(link);
            box.append(actions);
        }
        return box;
    }

    function renderCard(entry) {
        var card = document.createElement('article');
        card.className = 'card';
        var title = document.createElement('h2');
        title.textContent = entry.name;
        var platforms = document.createElement('div');
        platforms.className = 'platforms';
        platforms.append(
            platformBlock('iOS', entry.ios && entry.ios.bundleId, entry.appStoreUrl, 'App Store'),
            platformBlock('Android', entry.android, entry.playUrl, 'Play Store')
        );
        card.append(title, platforms);
        return card;
    }

    function currentHits() {
        var hits = AppIds.filterApps(search.value, category.value);
        hits.sort(function (a, b) {
            var byType = AppIds.groupLabel(a.category).localeCompare(AppIds.groupLabel(b.category), 'sv');
            if (byType) return byType;
            return a.name.localeCompare(b.name, 'sv');
        });
        return hits;
    }

    function render() {
        visible = currentHits();
        catalogEl.textContent = '';
        empty.classList.toggle('display-none', visible.length > 0);
        exportButton.disabled = visible.length === 0;
        var lastGroup = '';
        visible.forEach(function (entry) {
            if (entry.category !== lastGroup) {
                lastGroup = entry.category;
                var heading = document.createElement('h3');
                heading.className = 'group-title';
                heading.textContent = AppIds.groupLabel(entry.category);
                catalogEl.append(heading);
            }
            catalogEl.append(renderCard(entry));
        });
    }

    function exportCsv() {
        if (!visible.length) return;
        var csv = '\uFEFF' + AppIds.toCsv(visible);
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        var typeName = category.value || 'alla';
        link.href = url;
        link.download = 'app-id-' + typeName + '.csv';
        link.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showToast('CSV sparad');
    }

    search.addEventListener('input', render);
    category.addEventListener('change', render);
    exportButton.addEventListener('click', exportCsv);
    render();
    search.focus();
})();
