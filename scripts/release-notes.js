#!/usr/bin/env node
// Texten till en release på GitHub: bara den versionens avsnitt ur .github/release-notes.md, inte hela historiken.
//
// release-notes.md har en rad först (commit), sedan "## Nytt i X" för varje version, nyast först, och sist hur filerna
// laddas ner (från första rubriken som inte är "## Nytt i"). En release får raden, sitt eget avsnitt och nedladdningen,
// så att filerna inte hamnar under timmar av text. Samma uppdelning kortar en release som redan har hela historiken.
//
//   node scripts/release-notes.js <version> <commit> [kartdata]   skriver texten till stdout (byggflödet)

const fs = require('node:fs');
const path = require('node:path');

const SECTION = /^## Nytt i (\S+)\s*$/;

// { head, sections: [{ version, text }], tail }. Raderna behålls som de står.
function split(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const head = [], tail = [], sections = [];
    let cur = null, inTail = false;
    for (const line of lines) {
        const m = SECTION.exec(line);
        if (!inTail && m) {
            cur = { version: m[1], lines: [line] };
            sections.push(cur);
        } else if (!inTail && cur && /^## /.test(line)) {
            inTail = true;
            tail.push(line);
        } else if (inTail) tail.push(line);
        else if (cur) cur.lines.push(line);
        else head.push(line);
    }
    const join = (l) => l.join('\n').trim();
    return { head: join(head), sections: sections.map((s) => ({ version: s.version, text: join(s.lines) })), tail: join(tail) };
}

// Releasens text för version: raden först, avsnittet och nedladdningen. null när avsnittet saknas.
function notesFor(text, version) {
    const parts = split(text);
    const own = parts.sections.find((s) => s.version === version);
    if (!own) return null;
    const older = parts.sections.length > 1 ? 'Det som var nytt i tidigare versioner står i deras releaser.' : '';
    return [parts.head, own.text, older, parts.tail].filter(Boolean).join('\n\n') + '\n';
}

function main() {
    const [version, sha, maps] = process.argv.slice(2);
    if (!version) {
        console.error('Användning: node scripts/release-notes.js <version> <commit> [kartdata]');
        process.exit(2);
    }
    const file = path.join(__dirname, '..', '.github', 'release-notes.md');
    const notes = notesFor(fs.readFileSync(file, 'utf8'), version);
    if (!notes) {
        console.error('.github/release-notes.md har inget avsnitt "## Nytt i ' + version + '". Skriv det innan versionen höjs.');
        process.exit(1);
    }
    process.stdout.write(notes.split('{{VERSION}}').join(version).split('{{SHA}}').join(sha || '').split('{{MAPS}}').join(maps || ''));
}

if (require.main === module) main();

module.exports = { split, notesFor };
