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
        card.append(title);
        if (entry.note) {
            var note = document.createElement('p');
            note.className = 'note';
            note.textContent = entry.note;
            card.append(note);
        }
        var platforms = document.createElement('div');
        platforms.className = 'platforms';
        platforms.append(
            platformBlock('iOS', entry.ios && entry.ios.bundleId, entry.appStoreUrl, 'App Store'),
            platformBlock('Android', entry.android, entry.playUrl, 'Play Store')
        );
        card.append(platforms);
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
        downloadCsv(AppIds.toCsv(visible), 'app-id-' + (category.value || 'alla') + '.csv');
    }

    function downloadCsv(csv, filename) {
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showToast('CSV sparad');
    }

    // ---- Omvänd uppslagning ----------------------------------------------
    var searchView = document.getElementById('search-view');
    var searchToolbar = document.getElementById('search-toolbar');
    var reverseView = document.getElementById('reverse-view');
    var reverseInput = document.getElementById('reverse-input');
    var reverseSummary = document.getElementById('reverse-summary');
    var reverseResults = document.getElementById('reverse-results');
    var reverseExport = document.getElementById('reverse-export');
    var reverseClear = document.getElementById('reverse-clear');
    var reverseRows = [];
    var reverseTimer = null;

    function openTool(src) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ source: 'forensics-toolbox', type: 'open-tool', src: src }, '*');
        }
    }

    function smallButton(label, onClick) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'link-btn';
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    function cell(row, text, className) {
        var td = document.createElement('td');
        if (className) td.className = className;
        if (text instanceof Node) td.append(text);
        else td.textContent = text;
        row.append(td);
        return td;
    }

    function renderReverse() {
        reverseRows = AppIds.lookupIds(reverseInput.value);
        reverseResults.textContent = '';
        reverseExport.disabled = reverseRows.length === 0;
        if (!reverseRows.length) {
            reverseSummary.textContent = reverseInput.value.trim() ? 'Hittade inga id i texten.' : '';
            return;
        }
        var known = reverseRows.filter(function (row) { return row.entry; }).length;
        reverseSummary.innerHTML = '';
        [['Id', reverseRows.length], ['Kända', known], ['Okända', reverseRows.length - known]].forEach(function (pair) {
            var chip = document.createElement('span');
            chip.className = 'chip' + (pair[0] === 'Okända' && pair[1] ? ' warn' : '');
            chip.textContent = pair[0] + ' ';
            var b = document.createElement('b');
            b.textContent = pair[1];
            chip.append(b);
            reverseSummary.append(chip);
        });

        var table = document.createElement('table');
        table.className = 'reverse-table';
        var head = document.createElement('tr');
        ['Id', 'Antal', 'App', 'Typ', 'Plattform', ''].forEach(function (label) {
            var th = document.createElement('th');
            th.textContent = label;
            head.append(th);
        });
        table.append(head);

        reverseRows.forEach(function (row) {
            var tr = document.createElement('tr');
            if (!row.entry) tr.className = 'unknown';
            var code = document.createElement('code');
            code.textContent = row.input;
            cell(tr, code);
            cell(tr, String(row.count), 'num');
            var actions = document.createElement('div');
            actions.className = 'actions';
            if (row.entry) {
                var name = document.createElement('div');
                name.className = 'app-name';
                name.textContent = row.entry.name;
                var appCell = cell(tr, name);
                var sub = row.entry.note || (row.match === 'tillägg' ? 'Tillägg till ' + row.base : '');
                if (row.entry.note && row.match === 'tillägg') sub += ' · tillägg till ' + row.base;
                if (sub) {
                    var subEl = document.createElement('div');
                    subEl.className = 'sub';
                    subEl.textContent = sub;
                    appCell.append(subEl);
                }
                cell(tr, AppIds.groupLabel(row.entry.category));
                cell(tr, AppIds.platformLabel(row.platform));
                actions.append(smallButton('Kopiera', function () { copyText(row.input); }));
            } else {
                cell(tr, 'Okänd', 'muted');
                cell(tr, '');
                cell(tr, '');
                actions.append(
                    smallButton('Play Store', function () {
                        openExternal('https://play.google.com/store/apps/details?id=' + encodeURIComponent(row.input), 'Play Store');
                    }),
                    smallButton('App Store-uppslag', function () {
                        openExternal('https://itunes.apple.com/lookup?country=se&bundleId=' + encodeURIComponent(row.input), 'iTunes lookup');
                    }),
                    smallButton('Okänd app', function () { openTool('documentation/playbook-unknown-app.html'); })
                );
            }
            cell(tr, actions, 'row-actions');
            table.append(tr);
        });
        reverseResults.append(table);
    }

    function setMode(mode) {
        var reverse = mode === 'reverse';
        document.querySelectorAll('.mode-tab').forEach(function (tab) {
            tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
        });
        reverseView.classList.toggle('display-none', !reverse);
        searchView.classList.toggle('display-none', reverse);
        searchToolbar.classList.toggle('display-none', reverse);
        (reverse ? reverseInput : search).focus();
    }

    document.querySelectorAll('.mode-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { setMode(tab.getAttribute('data-mode')); });
    });
    reverseInput.addEventListener('input', function () {
        clearTimeout(reverseTimer);
        reverseTimer = setTimeout(renderReverse, 150);
    });
    reverseClear.addEventListener('click', function () {
        reverseInput.value = '';
        renderReverse();
        reverseInput.focus();
    });
    reverseExport.addEventListener('click', function () {
        if (reverseRows.length) downloadCsv(AppIds.lookupToCsv(reverseRows), 'app-id-uppslag.csv');
    });

    search.addEventListener('input', render);
    category.addEventListener('change', render);
    exportButton.addEventListener('click', exportCsv);
    render();
    setMode(new URLSearchParams(location.search).get('mode') === 'reverse' ? 'reverse' : 'search');
})();
