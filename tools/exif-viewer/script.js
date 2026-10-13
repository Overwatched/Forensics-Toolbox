(function () {
    'use strict';

    // AppleDouble-filer (._namn) och mappmetadata från macOS/Windows ger bara brus.
    var SKIP_NAMES = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$|^\._/i;

    var FILTERS = [
        { id: 'all', label: 'Alla' },
        { id: 'gps', label: 'Med position' },
        { id: 'ext', label: 'Fel filändelse' },
        { id: 'stripped', label: 'Ingen kamerametadata' },
        { id: 'screenshot', label: 'Skärmdumpar' },
        { id: 'edited', label: 'Tecken på redigering' },
        { id: 'app', label: 'App i filnamn' },
        { id: 'warning', label: 'Fel och varningar' },
    ];

    function $(id) { return document.getElementById(id); }

    var drop = $('drop');
    var engineStatus = $('engine-status');
    var folderInput = $('folder-input');
    var fileInput = $('file-input');
    var progressBox = $('progress');
    var progressText = $('progress-text');
    var barFill = $('bar-fill');
    var results = $('results');
    var chipsEl = $('filter-chips');
    var searchInput = $('search');
    var tbody = $('rows');
    var empty = $('empty');
    var detail = $('detail');
    var backdrop = $('backdrop');
    var tagSearch = $('tag-search');
    var toast = $('toast');
    var toastTimer = null;

    var rows = [];
    var seen = {};
    var queue = [];
    var busy = null;
    var nextId = 1;
    var batch = { total: 0, done: 0, started: 0 };
    var engine = { worker: null, ready: false, version: '' };
    var filter = 'all';
    var query = '';
    var sortKey = 'path';
    var sortDesc = false;
    var renderTimer = null;
    var selected = null;

    var appNames = {};
    if (window.AppIds) {
        AppIds.APPS.forEach(function (a) { appNames[a.id] = a.name; });
    }

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

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
            window.parent.postMessage({ source: 'forensics-toolbox', type: 'open-external', href: url, title: title }, '*');
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function download(content, type, filename) {
        var blob = new Blob(['\uFEFF' + content], { type: type });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function localTime(ms) {
        if (!ms) return '';
        var d = new Date(ms);
        var off = -d.getTimezoneOffset();
        var sign = off < 0 ? '-' : '+';
        off = Math.abs(off);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':'
            + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
    }

    function humanSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        var units = ['KB', 'MB', 'GB', 'TB'];
        var v = bytes;
        var i = -1;
        do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
        return v.toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ' ' + units[i];
    }

    function duration(ms) {
        var s = Math.round(ms / 1000);
        return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    }

    // --- ExifTool-motorn ---------------------------------------------------------

    function setEngineStatus(state, text) {
        engineStatus.className = 'engine-status' + (state ? ' ' + state : '');
        engineStatus.textContent = text;
    }

    function startEngine() {
        if (!window.EXIFTOOL_WORKER_SOURCE || !window.EXIFTOOL_WASM_GZ) {
            setEngineStatus('failed', 'ExifTool saknas (vendor/exiftool).');
            return;
        }
        engine.ready = false;
        var url = URL.createObjectURL(new Blob([window.EXIFTOOL_WORKER_SOURCE], { type: 'text/javascript' }));
        var worker = new Worker(url);
        engine.worker = worker;
        worker.onmessage = function (event) {
            var msg = event.data || {};
            if (msg.type === 'ready') {
                URL.revokeObjectURL(url);
                engine.ready = true;
                engine.version = msg.version ? 'ExifTool ' + msg.version : 'ExifTool';
                $('engine-version').textContent = engine.version;
                setEngineStatus('ready', engine.version + ' redo — inget lämnar datorn');
                pump();
            } else if (msg.type === 'init-error') {
                setEngineStatus('failed', 'ExifTool kunde inte starta: ' + msg.error);
            } else if (msg.type === 'result' && busy && msg.id === busy.id) {
                finish(busy, msg);
            }
        };
        worker.onerror = function (event) {
            event.preventDefault();
            var row = busy;
            busy = null;
            worker.terminate();
            if (row) complete(row, { 'ExifTool:Error': 'ExifTool avbröts på filen: ' + (event.message || 'okänt fel') });
            startEngine();
        };
        worker.postMessage({ type: 'init', wasmGz: window.EXIFTOOL_WASM_GZ });
    }

    // --- Kö -----------------------------------------------------------------------

    function addFiles(items) {
        var skipped = 0;
        var added = 0;
        if (!busy && !queue.length) batch = { total: 0, done: 0, started: Date.now() };
        items.forEach(function (it) {
            var file = it.file;
            if (SKIP_NAMES.test(file.name)) { skipped++; return; }
            var path = it.path || file.name;
            var key = path + '|' + file.size + '|' + file.lastModified;
            if (seen[key]) return;
            seen[key] = true;
            var row = {
                id: nextId++, path: path, name: file.name, size: file.size,
                modified: localTime(file.lastModified), file: file, status: 'queued', tags: null, summary: null, hay: '',
            };
            rows.push(row);
            queue.push(row);
            added++;
        });
        if (!added) {
            showToast(skipped ? 'Bara systemfiler — inget att läsa' : 'Filerna är redan inlästa');
            return;
        }
        batch.total += added;
        if (skipped) showToast(skipped + ' systemfiler hoppades över');
        results.classList.remove('display-none');
        updateProgress();
        scheduleRender();
        pump();
    }

    function pump() {
        if (busy || !engine.ready) return;
        var row = queue.shift();
        if (!row) return;
        busy = row;
        engine.worker.postMessage({ type: 'parse', id: row.id, file: row.file });
    }

    function readRange(file) {
        return function (start, end) {
            return file.slice(start, end).arrayBuffer().then(function (b) { return new Uint8Array(b); });
        };
    }

    function inflateRaw(bytes) {
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }

    function withOffice(row, tags) {
        if (String(tags['File:FileTypeExtension'] || '').toLowerCase() !== 'zip' || !row.file) return Promise.resolve(tags);
        return ExifCore.readZipEntries(row.file.size, readRange(row.file), inflateRaw, ExifCore.OFFICE_FILES)
            .then(function (files) { return Object.assign({}, tags, ExifCore.officeTags(files)); })
            .catch(function () { return tags; });
    }

    function finish(row, msg) {
        if (!msg.ok) {
            busy = null;
            complete(row, { 'ExifTool:Error': msg.error });
            pump();
            return;
        }
        withOffice(row, msg.tags).then(function (tags) {
            busy = null;
            complete(row, tags);
            pump();
        });
    }

    function complete(row, tags) {
        if (rows.indexOf(row) < 0) {
            updateProgress();
            return;
        }
        row.tags = ExifCore.cleanTags(tags);
        row.summary = ExifCore.summarize(row.tags, row.name);
        row.status = 'done';
        row.file = null;
        var s = row.summary;
        row.hay = [
            row.path, s.type, s.mime, s.taken && s.taken.text, s.device && s.device.text, s.software && s.software.text,
            s.flags.map(function (f) { return f.label; }).join(' '),
            s.apps.map(function (a) { return appNames[a] || a; }).join(' '),
            JSON.stringify(row.tags),
        ].join(' ').toLowerCase();
        batch.done++;
        updateProgress();
        scheduleRender();
        if (selected === row) renderDetail();
    }

    function cancel() {
        queue.forEach(function (r) { delete seen[r.path + '|' + r.size + '|' + (r.file && r.file.lastModified)]; });
        var dropped = queue.length;
        queue = [];
        rows = rows.filter(function (r) { return r.status !== 'queued' || r === busy; });
        batch.total -= dropped;
        updateProgress();
        scheduleRender();
        showToast(dropped + ' filer lästes inte');
    }

    function clearAll() {
        queue = [];
        rows = [];
        seen = {};
        batch = { total: 0, done: 0, started: 0 };
        closeDetail();
        filter = 'all';
        searchInput.value = '';
        query = '';
        results.classList.toggle('display-none', !rows.length);
        updateProgress();
        scheduleRender();
    }

    function updateProgress() {
        var running = queue.length || (busy && rows.indexOf(busy) >= 0);
        progressBox.classList.toggle('display-none', !running);
        if (!running) {
            if (batch.total) {
                showToast(batch.done + ' filer lästa på ' + duration(Date.now() - batch.started));
            }
            batch = { total: 0, done: 0, started: 0 };
            return;
        }
        var pct = batch.total ? Math.round((batch.done / batch.total) * 100) : 0;
        progressText.textContent = engine.ready
            ? 'Läser ' + batch.done.toLocaleString('sv-SE') + ' av ' + batch.total.toLocaleString('sv-SE') + ' filer'
            : 'Väntar på ExifTool…';
        barFill.style.width = pct + '%';
    }

    // --- Inläsning ----------------------------------------------------------------

    function fromInput(input) {
        var items = Array.prototype.map.call(input.files || [], function (f) {
            return { file: f, path: f.webkitRelativePath || f.name };
        });
        input.value = '';
        if (items.length) addFiles(items);
    }

    function readDirectory(dir, out) {
        var reader = dir.createReader();
        var entries = [];
        return new Promise(function (resolve) {
            (function next() {
                reader.readEntries(function (batchEntries) {
                    if (!batchEntries.length) {
                        Promise.all(entries.map(function (e) { return walk(e, out); })).then(resolve);
                        return;
                    }
                    entries = entries.concat(Array.prototype.slice.call(batchEntries));
                    next();
                }, function () { resolve(); });
            })();
        });
    }

    function walk(entry, out) {
        if (entry.isFile) {
            return new Promise(function (resolve) {
                entry.file(function (f) {
                    out.push({ file: f, path: entry.fullPath.replace(/^\//, '') });
                    resolve();
                }, function () { resolve(); });
            });
        }
        if (entry.isDirectory) return readDirectory(entry, out);
        return Promise.resolve();
    }

    function fromDrop(dataTransfer) {
        var entries = [];
        var items = dataTransfer.items || [];
        for (var i = 0; i < items.length; i++) {
            var entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
            if (entry) entries.push(entry);
        }
        if (!entries.length) {
            addFiles(Array.prototype.map.call(dataTransfer.files || [], function (f) { return { file: f, path: f.name }; }));
            return;
        }
        var out = [];
        Promise.all(entries.map(function (e) { return walk(e, out); })).then(function () {
            out.sort(function (a, b) { return a.path.localeCompare(b.path, 'sv'); });
            if (out.length) addFiles(out);
        });
    }

    // --- Tabell -------------------------------------------------------------------

    function hasFlag(row, id) {
        return row.summary && row.summary.flags.some(function (f) { return f.id === id; });
    }

    function sortValue(row) {
        var s = row.summary || {};
        switch (sortKey) {
            case 'type': return (s.type || '').toLowerCase();
            case 'taken': return s.taken ? s.taken.sort : '';
            case 'device': return s.device ? s.device.text.toLowerCase() : '';
            case 'software': return s.software ? s.software.text.toLowerCase() : '';
            case 'position': return s.position ? 'x' : '';
            default: return row.path.toLowerCase();
        }
    }

    function visibleRows() {
        var q = query.toLowerCase();
        var list = rows.filter(function (r) {
            if (filter !== 'all' && !hasFlag(r, filter)) return false;
            if (!q) return true;
            return (r.hay || r.path.toLowerCase()).indexOf(q) >= 0;
        });
        return list.sort(function (a, b) {
            var va = sortValue(a);
            var vb = sortValue(b);
            if (!va && vb) return 1;
            if (va && !vb) return -1;
            var c = va < vb ? -1 : va > vb ? 1 : 0;
            if (!c) c = a.path.localeCompare(b.path, 'sv');
            return sortDesc ? -c : c;
        });
    }

    function cell(main, sub, className) {
        var td = make('td', className);
        if (main) td.append(make('div', '', main));
        else td.append(make('span', 'muted', '—'));
        if (sub) td.append(make('div', 'cell-sub', sub));
        return td;
    }

    function flagChips(flags) {
        var box = make('div', 'flags');
        flags.forEach(function (f) {
            var chip = make('span', 'flag ' + f.id, f.label);
            chip.title = f.reason;
            box.append(chip);
        });
        return box;
    }

    function buildRow(row) {
        var tr = make('tr', row.status === 'queued' ? 'pending' : '');
        tr.dataset.id = row.id;
        var file = make('td', 'cell-file');
        file.append(make('div', 'name', row.name));
        var dir = row.path.slice(0, Math.max(0, row.path.length - row.name.length)).replace(/\/$/, '');
        if (dir) file.append(make('div', 'dir', dir));
        tr.append(file);

        if (row.status === 'queued') {
            var wait = make('td', 'muted', row === busy ? 'Läser…' : 'Väntar…');
            wait.colSpan = 6;
            tr.append(wait);
            return tr;
        }

        var s = row.summary;
        var typeCell = cell(s.type, humanSize(row.size));
        if (s.mismatch) typeCell.firstChild.className = 'bad';
        tr.append(typeCell);
        tr.append(cell(s.taken && s.taken.text, s.taken && s.taken.kind));
        tr.append(cell(s.device && s.device.text));
        tr.append(cell(s.software && s.software.text));
        tr.append(cell(s.position && (s.position.lat + ', ' + s.position.lon), null, 'mono'));
        var flagsTd = make('td');
        flagsTd.append(flagChips(s.flags.filter(function (f) { return f.id !== 'gps'; })));
        tr.append(flagsTd);
        return tr;
    }

    function renderChips() {
        chipsEl.textContent = '';
        FILTERS.forEach(function (f) {
            var count = f.id === 'all' ? rows.length : rows.filter(function (r) { return hasFlag(r, f.id); }).length;
            if (!count && f.id !== 'all' && filter !== f.id) return;
            var chip = make('button', 'filter-chip' + (filter === f.id ? ' active' : ''), f.label);
            chip.type = 'button';
            chip.append(make('b', '', count.toLocaleString('sv-SE')));
            chip.addEventListener('click', function () {
                filter = f.id;
                render();
            });
            chipsEl.append(chip);
        });
    }

    function render() {
        renderTimer = null;
        renderChips();
        var list = visibleRows();
        var frag = document.createDocumentFragment();
        list.forEach(function (r) { frag.append(buildRow(r)); });
        tbody.textContent = '';
        tbody.append(frag);
        empty.classList.toggle('display-none', !!list.length || !rows.length);
        document.querySelectorAll('.files th[data-sort]').forEach(function (th) {
            th.classList.toggle('sorted', th.dataset.sort === sortKey);
            th.classList.toggle('desc', th.dataset.sort === sortKey && sortDesc);
        });
        var done = rows.some(function (r) { return r.status === 'done'; });
        $('export-csv').disabled = !done;
        $('export-json').disabled = !done;
    }

    function scheduleRender() {
        if (renderTimer) return;
        renderTimer = setTimeout(render, rows.length > 500 ? 400 : 120);
    }

    // --- Detaljvy -----------------------------------------------------------------

    function summaryRow(dl, label, value, source) {
        if (!value) return null;
        dl.append(make('dt', '', label));
        var dd = make('dd');
        if (typeof value === 'string') dd.append(document.createTextNode(value));
        else dd.append(value);
        if (source) dd.append(make('span', 'src', source));
        dl.append(dd);
        return dd;
    }

    function linkButton(text, onClick) {
        var b = make('button', 'link-btn', text);
        b.type = 'button';
        b.addEventListener('click', onClick);
        return b;
    }

    function renderDetail() {
        var row = selected;
        if (!row) return;
        $('detail-name').textContent = row.name;
        $('detail-path').textContent = row.path;
        var dl = $('detail-summary');
        dl.textContent = '';
        var s = row.summary;
        summaryRow(dl, 'Storlek', humanSize(row.size) + ' (' + row.size.toLocaleString('sv-SE') + ' byte)');
        summaryRow(dl, 'Ändrad', row.modified, 'filsystemet');
        if (!s) {
            summaryRow(dl, 'Status', row === busy ? 'Läser…' : 'Väntar på ExifTool');
            $('detail-groups').textContent = '';
            return;
        }
        var type = summaryRow(dl, 'Filtyp', [s.type, s.mime].filter(Boolean).join(' · '), 'File:FileType');
        if (type && s.mismatch) type.append(make('div', 'reason bad', s.flags.filter(function (f) { return f.id === 'ext'; })[0].reason));
        if (s.taken) summaryRow(dl, s.taken.kind, s.taken.text, s.taken.source);
        if (s.device) summaryRow(dl, 'Enhet', s.device.text, s.device.source);
        if (s.software) summaryRow(dl, 'Programvara', s.software.text, s.software.source);
        if (s.position) {
            var pos = make('span');
            var coords = s.position.lat + ', ' + s.position.lon;
            pos.append(make('span', 'mono', coords));
            var actions = make('span', 'inline-actions');
            actions.append(linkButton('Kopiera', function () { copyText(coords); }));
            actions.append(linkButton('Visa på karta', function () {
                openExternal('https://www.openstreetmap.org/?mlat=' + s.position.lat + '&mlon=' + s.position.lon
                    + '#map=17/' + s.position.lat + '/' + s.position.lon, 'OpenStreetMap');
            }));
            pos.append(actions);
            summaryRow(dl, 'Position', pos, s.position.source);
        }
        if (s.apps.length) {
            summaryRow(dl, 'App i filnamn', s.apps.map(function (a) { return appNames[a] || a; }).join(', '), 'App-ID');
        }
        s.flags.forEach(function (f) {
            if (f.id === 'ext' || f.id === 'gps' || f.id === 'app') return;
            var box = make('span');
            box.append(make('div', '', f.label));
            box.append(make('div', 'reason', f.reason));
            summaryRow(dl, 'Flagga', box);
        });
        renderGroups();
    }

    function renderGroups() {
        var host = $('detail-groups');
        host.textContent = '';
        if (!selected || !selected.tags) return;
        var q = tagSearch.value.trim().toLowerCase();
        ExifCore.groupTags(selected.tags).forEach(function (g) {
            var entries = g.entries.filter(function (e) {
                return !q || e.key.toLowerCase().indexOf(q) >= 0 || e.value.toLowerCase().indexOf(q) >= 0;
            });
            if (!entries.length) return;
            var box = make('section', 'tag-group' + (g.group === 'Office' ? ' derived' : ''));
            var h = make('h3', '', g.group);
            h.append(make('span', 'count', String(entries.length)));
            box.append(h);
            var table = make('table', 'tag-table');
            entries.forEach(function (e) {
                var tr = make('tr');
                tr.append(make('td', '', e.tag));
                tr.append(make('td', '', e.value));
                table.append(tr);
            });
            box.append(table);
            host.append(box);
        });
        if (!host.childNodes.length) host.append(make('p', 'empty', 'Inga taggar matchar.'));
    }

    function openDetail(row) {
        selected = row;
        tagSearch.value = '';
        detail.classList.remove('display-none');
        backdrop.classList.remove('display-none');
        detail.scrollTop = 0;
        renderDetail();
    }

    function closeDetail() {
        selected = null;
        detail.classList.add('display-none');
        backdrop.classList.add('display-none');
    }

    // --- Export -------------------------------------------------------------------

    function stamp() {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function exportRows() {
        return visibleRows().filter(function (r) { return r.status === 'done'; });
    }

    $('export-csv').addEventListener('click', function () {
        download(ExifCore.toCsv(exportRows()), 'text/csv;charset=utf-8', 'exif-' + stamp() + '.csv');
        showToast('CSV sparad');
    });

    $('export-json').addEventListener('click', function () {
        var data = {
            tool: 'Forensics Toolbox — EXIF-visare',
            engine: engine.version,
            exported: localTime(Date.now()),
            files: exportRows().map(function (r) {
                return { path: r.path, size: r.size, modified: r.modified, summary: r.summary, tags: r.tags };
            }),
        };
        download(JSON.stringify(data, null, 2), 'application/json;charset=utf-8', 'exif-' + stamp() + '.json');
        showToast('JSON sparad');
    });

    // --- Händelser ----------------------------------------------------------------

    $('pick-folder').addEventListener('click', function () { folderInput.click(); });
    $('pick-files').addEventListener('click', function () { fileInput.click(); });
    folderInput.addEventListener('change', function () { fromInput(folderInput); });
    fileInput.addEventListener('change', function () { fromInput(fileInput); });
    $('cancel').addEventListener('click', cancel);
    $('clear').addEventListener('click', clearAll);

    // Hela sidan tar emot släppta filer, annars navigerar ramen till filen.
    document.addEventListener('dragover', function (e) {
        e.preventDefault();
        drop.classList.add('dragover');
    });
    document.addEventListener('dragleave', function (e) {
        if (!e.relatedTarget) drop.classList.remove('dragover');
    });
    document.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('dragover');
        if (e.dataTransfer) fromDrop(e.dataTransfer);
    });

    searchInput.addEventListener('input', function () {
        query = searchInput.value.trim();
        scheduleRender();
    });

    document.querySelectorAll('.files th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
            if (sortKey === th.dataset.sort) sortDesc = !sortDesc;
            else { sortKey = th.dataset.sort; sortDesc = false; }
            render();
        });
    });

    tbody.addEventListener('click', function (e) {
        var tr = e.target.closest('tr');
        if (!tr) return;
        var id = Number(tr.dataset.id);
        var row = rows.filter(function (r) { return r.id === id; })[0];
        if (row) openDetail(row);
    });

    $('detail-close').addEventListener('click', closeDetail);
    backdrop.addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && selected) closeDetail();
    });
    tagSearch.addEventListener('input', renderGroups);
    $('copy-json').addEventListener('click', function () {
        if (!selected) return;
        copyText(JSON.stringify({ path: selected.path, size: selected.size, modified: selected.modified, tags: selected.tags }, null, 2));
    });

    startEngine();
})();
