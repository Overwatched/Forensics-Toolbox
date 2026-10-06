(function () {
    'use strict';

    var DISPLAY_LIMIT = 4000;
    var sides = { a: null, b: null };
    var view = 'side';

    var summaryEl = document.getElementById('summary');
    var noteEl = document.getElementById('note');
    var diffEl = document.getElementById('diff');
    var onlyChangesEl = document.getElementById('only-changes');
    var ignoreBlankEl = document.getElementById('ignore-blank');

    function formatBytes(size) {
        if (size < 1024) return size + ' B';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' kB';
        return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function countPhrase(n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
    }

    function outcomeText(result) {
        if (result.identical) return 'Identiska';
        var parts = [];
        if (result.removed) parts.push(countPhrase(result.removed, 'borttagen', 'borttagna'));
        if (result.added) parts.push(countPhrase(result.added, 'tillagd', 'tillagda'));
        return parts.join(', ');
    }

    function hashOf(bytes) {
        return ToolboxHashing.hashBytes(bytes, ['sha256']).sha256;
    }

    function fromBytes(name, bytes) {
        var entry = {
            name: name,
            size: bytes.length,
            hash: hashOf(bytes),
            binary: false,
            tooLarge: false,
            text: '',
        };
        if (bytes.length > FileDiff.MAX_BYTES) {
            entry.tooLarge = true;
            return entry;
        }
        if (FileDiff.looksBinary(bytes)) {
            entry.binary = true;
            return entry;
        }
        entry.text = new TextDecoder('utf-8').decode(bytes);
        return entry;
    }

    function readFile(file) {
        return file.arrayBuffer().then(function (buffer) {
            return fromBytes(file.name, new Uint8Array(buffer));
        });
    }

    function fromPaste(text) {
        if (!text) return null;
        return fromBytes('Inklistrad text', new TextEncoder().encode(text));
    }

    function setFileLabel(side, entry) {
        var label = document.querySelector('.side[data-side="' + side + '"] .file-label');
        if (!entry || entry.name === 'Inklistrad text') {
            label.textContent = 'Välj en fil eller dra hit';
            return;
        }
        label.textContent = entry.name + ' · ' + formatBytes(entry.size);
    }

    function renderLine(text) {
        var span = document.createElement('span');
        span.className = 'txt';
        span.textContent = text == null ? '' : text;
        return span;
    }

    function appendSideBySide(row) {
        var line = document.createElement('div');
        line.className = 'diff-row';
        var leftNum = document.createElement('span');
        leftNum.className = 'num';
        leftNum.textContent = row.a ? String(row.a.num) : '';
        var leftText = renderLine(row.a ? row.a.text : '');
        var rightNum = document.createElement('span');
        rightNum.className = 'num';
        rightNum.textContent = row.b ? String(row.b.num) : '';
        var rightText = renderLine(row.b ? row.b.text : '');
        if (row.kind === 'remove' || row.kind === 'change') {
            leftNum.classList.add('cell-remove');
            leftText.classList.add('cell-remove');
        }
        if (row.kind === 'add' || row.kind === 'change') {
            rightNum.classList.add('cell-add');
            rightText.classList.add('cell-add');
        }
        line.append(leftNum, leftText, rightNum, rightText);
        return line;
    }

    function appendUnified(row) {
        var fragment = document.createDocumentFragment();
        function one(marker, entry, kind) {
            if (!entry) return;
            var line = document.createElement('div');
            line.className = 'diff-row';
            var num = document.createElement('span');
            num.className = 'num';
            num.textContent = String(entry.num);
            var mark = document.createElement('span');
            mark.className = 'mark';
            mark.textContent = marker;
            var text = renderLine(entry.text);
            if (kind === 'remove') {
                num.classList.add('cell-remove');
                mark.classList.add('cell-remove');
                text.classList.add('cell-remove');
            }
            if (kind === 'add') {
                num.classList.add('cell-add');
                mark.classList.add('cell-add');
                text.classList.add('cell-add');
            }
            line.append(num, mark, text);
            fragment.append(line);
        }
        if (row.kind === 'change') {
            one('−', row.a, 'remove');
            one('+', row.b, 'add');
        } else if (row.kind === 'remove') {
            one('−', row.a, 'remove');
        } else if (row.kind === 'add') {
            one('+', row.b, 'add');
        } else {
            one(' ', row.a, 'same');
        }
        return fragment;
    }

    function showNote(text, withHashLink) {
        noteEl.classList.remove('display-none');
        noteEl.textContent = '';
        noteEl.append(document.createTextNode(text));
        if (!withHashLink) return;
        noteEl.append(document.createTextNode(' '));
        var link = document.createElement('a');
        link.href = '../hash-calculator/hash.html';
        link.setAttribute('data-tool', 'tools/hash-calculator/hash.html');
        link.textContent = 'Hash Calculator';
        noteEl.append(link);
    }

    function renderHashes(a, b) {
        var box = document.createElement('div');
        box.className = 'hashes';
        ['A', 'B'].forEach(function (label, index) {
            var entry = index === 0 ? a : b;
            var row = document.createElement('div');
            row.textContent = label + '  ' + entry.hash + '  ' + entry.name;
            box.append(row);
        });
        return box;
    }

    function render() {
        summaryEl.classList.add('display-none');
        noteEl.classList.add('display-none');
        diffEl.classList.add('display-none');
        diffEl.textContent = '';
        var a = sides.a;
        var b = sides.b;
        if (!a || !b) return;

        summaryEl.classList.remove('display-none');
        summaryEl.classList.remove('is-same', 'is-diff');
        var title = document.createElement('h3');
        summaryEl.textContent = '';
        summaryEl.append(title);

        if (a.tooLarge || b.tooLarge) {
            summaryEl.classList.add('is-diff');
            title.textContent = 'För stor för radjämförelse';
            showNote('Max är 5 MB per sida.', true);
            return;
        }

        if (a.binary || b.binary) {
            var sameHash = a.hash === b.hash;
            summaryEl.classList.add(sameHash ? 'is-same' : 'is-diff');
            title.textContent = sameHash ? 'Identiska' : 'Skiljer sig';
            summaryEl.append(renderHashes(a, b));
            showNote(sameHash
                ? 'Binärt innehåll med samma SHA-256.'
                : 'Minst en fil är binär, så raderna jämförs inte.', true);
            return;
        }

        var result = FileDiff.analyzeText(a.text, b.text, { ignoreBlank: ignoreBlankEl.checked });
        if (result.tooLarge) {
            summaryEl.classList.add('is-diff');
            title.textContent = 'För stor för radjämförelse';
            showNote('Max är 5 MB per sida.', true);
            return;
        }
        if (result.timedOut) {
            summaryEl.classList.add('is-diff');
            title.textContent = 'Jämförelsen tog för lång tid';
            showNote('Filerna är text, men skillnaden är för dyr att räkna ut här.', true);
            return;
        }

        summaryEl.classList.add(result.identical ? 'is-same' : 'is-diff');
        title.textContent = outcomeText(result);
        summaryEl.append(renderHashes(a, b));

        var rows = result.rows;
        if (onlyChangesEl.checked) rows = rows.filter(function (row) { return row.kind !== 'same'; });
        if (!rows.length) return;

        var truncated = false;
        if (rows.length > DISPLAY_LIMIT) {
            rows = rows.slice(0, DISPLAY_LIMIT);
            truncated = true;
        }

        diffEl.classList.remove('display-none');
        diffEl.classList.toggle('is-unified', view === 'unified');
        if (view === 'side') {
            var head = document.createElement('div');
            head.className = 'diff-columns';
            ['', 'A', '', 'B'].forEach(function (label) {
                var span = document.createElement('span');
                span.textContent = label;
                head.append(span);
            });
            diffEl.append(head);
        }
        var fragment = document.createDocumentFragment();
        rows.forEach(function (row) {
            fragment.append(view === 'unified' ? appendUnified(row) : appendSideBySide(row));
        });
        diffEl.append(fragment);
        if (truncated) showNote('Visar de första ' + DISPLAY_LIMIT + ' raderna. Kryssa i bara ändringar om du vill se skillnaderna först.');
    }

    function bindSide(side) {
        var rootEl = document.querySelector('.side[data-side="' + side + '"]');
        var input = rootEl.querySelector('input[type="file"]');
        var drop = rootEl.querySelector('.file-drop');
        var text = rootEl.querySelector('textarea');

        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            text.value = '';
            readFile(file).then(function (entry) {
                sides[side] = entry;
                setFileLabel(side, entry);
                render();
            });
        });

        ['dragenter', 'dragover'].forEach(function (type) {
            drop.addEventListener(type, function (event) {
                event.preventDefault();
                drop.classList.add('is-dragover');
            });
        });
        ['dragleave', 'drop'].forEach(function (type) {
            drop.addEventListener(type, function (event) {
                event.preventDefault();
                drop.classList.remove('is-dragover');
            });
        });
        drop.addEventListener('drop', function (event) {
            var file = event.dataTransfer.files && event.dataTransfer.files[0];
            if (!file) return;
            text.value = '';
            readFile(file).then(function (entry) {
                sides[side] = entry;
                setFileLabel(side, entry);
                render();
            });
        });

        text.addEventListener('input', function () {
            input.value = '';
            sides[side] = fromPaste(text.value);
            setFileLabel(side, sides[side]);
            render();
        });
    }

    document.querySelectorAll('.clear-side').forEach(function (button) {
        button.addEventListener('click', function () {
            var side = button.getAttribute('data-side');
            var rootEl = document.querySelector('.side[data-side="' + side + '"]');
            rootEl.querySelector('textarea').value = '';
            rootEl.querySelector('input[type="file"]').value = '';
            sides[side] = null;
            setFileLabel(side, null);
            render();
        });
    });

    onlyChangesEl.addEventListener('change', render);
    ignoreBlankEl.addEventListener('change', render);
    document.getElementById('view-side').addEventListener('click', function () {
        view = 'side';
        document.getElementById('view-side').classList.add('active');
        document.getElementById('view-unified').classList.remove('active');
        render();
    });
    document.getElementById('view-unified').addEventListener('click', function () {
        view = 'unified';
        document.getElementById('view-unified').classList.add('active');
        document.getElementById('view-side').classList.remove('active');
        render();
    });

    document.addEventListener('click', function (event) {
        var link = event.target.closest('[data-tool]');
        if (!link || !window.parent || window.parent === window) return;
        event.preventDefault();
        window.parent.postMessage({
            source: 'forensics-toolbox',
            type: 'open-tool',
            src: link.getAttribute('data-tool'),
        }, '*');
    });

    ['dragover', 'drop'].forEach(function (type) {
        document.addEventListener(type, function (event) {
            if (event.target.closest('.file-drop')) return;
            event.preventDefault();
        });
    });

    bindSide('a');
    bindSide('b');
})();
