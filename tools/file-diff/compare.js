// Radvis jämförelse av två texter. Algoritmen kommer från vendor/diff.js (jsdiff).
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.FileDiff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var MAX_BYTES = 5 * 1024 * 1024;
    var SAMPLE = 8192;

    function diffLib() {
        if (typeof module === 'object' && module.exports) return require('./vendor/diff.js');
        return root.Diff;
    }

    function looksBinary(bytes) {
        var n = Math.min(bytes.length, SAMPLE);
        var controls = 0;
        for (var i = 0; i < n; i++) {
            var b = bytes[i];
            if (b === 0) return true;
            if (b < 32 && b !== 9 && b !== 10 && b !== 13) controls++;
        }
        return n > 0 && controls / n > 0.1;
    }

    // "a\n" och "a" blir samma rad. Avslutande radbrytning räknas inte som en extra tom rad.
    function splitLines(text) {
        var normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (normalized.endsWith('\n')) normalized = normalized.slice(0, -1);
        if (normalized === '') return [];
        return normalized.split('\n');
    }

    function isBlank(line) {
        return line.trim() === '';
    }

    function prepare(lines, ignoreBlank) {
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            if (ignoreBlank && isBlank(lines[i])) continue;
            out.push({ num: i + 1, text: lines[i] });
        }
        return out;
    }

    function chunkLines(value) {
        if (!value) return [];
        var parts = String(value).split('\n');
        if (parts.length && parts[parts.length - 1] === '') parts.pop();
        return parts;
    }

    function analyzeText(textA, textB, options) {
        var ignoreBlank = !!(options && options.ignoreBlank);
        if (String(textA).length > MAX_BYTES || String(textB).length > MAX_BYTES) {
            return { tooLarge: true, limit: MAX_BYTES };
        }

        var preparedA = prepare(splitLines(textA), ignoreBlank);
        var preparedB = prepare(splitLines(textB), ignoreBlank);
        function joinLines(lines) {
            if (!lines.length) return '';
            return lines.map(function (line) { return line.text; }).join('\n') + '\n';
        }

        var joinedA = joinLines(preparedA);
        var joinedB = joinLines(preparedB);
        var changes = diffLib().diffLines(joinedA, joinedB);
        if (!Array.isArray(changes)) return { timedOut: true };

        var rows = [];
        var ia = 0;
        var ib = 0;
        var added = 0;
        var removed = 0;
        var index = 0;

        while (index < changes.length) {
            var part = changes[index];
            if (!part.added && !part.removed) {
                chunkLines(part.value).forEach(function () {
                    rows.push({ kind: 'same', a: preparedA[ia++], b: preparedB[ib++] });
                });
                index++;
                continue;
            }

            var removedLines = [];
            var addedLines = [];
            if (part.removed) {
                removedLines = chunkLines(part.value);
                index++;
                if (changes[index] && changes[index].added) {
                    addedLines = chunkLines(changes[index].value);
                    index++;
                }
            } else {
                addedLines = chunkLines(part.value);
                index++;
            }

            var width = Math.max(removedLines.length, addedLines.length);
            for (var k = 0; k < width; k++) {
                var left = k < removedLines.length ? preparedA[ia++] : null;
                var right = k < addedLines.length ? preparedB[ib++] : null;
                var kind = left && right ? 'change' : left ? 'remove' : 'add';
                if (left) removed++;
                if (right) added++;
                rows.push({ kind: kind, a: left, b: right });
            }
        }

        return {
            identical: added === 0 && removed === 0,
            added: added,
            removed: removed,
            rows: rows,
        };
    }

    return {
        MAX_BYTES: MAX_BYTES,
        looksBinary: looksBinary,
        analyzeText: analyzeText,
    };
}));
