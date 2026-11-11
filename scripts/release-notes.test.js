// Releasens text: bara versionens avsnitt och nedladdningen, inte hela historiken.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { split, notesFor } = require('./release-notes');

const SAMPLE = [
    'Automatiskt byggd från commit `{{SHA}}`.',
    '',
    '## Nytt i 1.3',
    '',
    'Det nyaste.',
    '',
    '- **Punkt:** text.',
    '  - underpunkt',
    '',
    '## Nytt i 1.2',
    '',
    '- Äldre.',
    '',
    '## Windows',
    '- **ForensicsToolbox-{{VERSION}}-Installer.exe** — installer',
    '',
    'Kartdata © OpenStreetMap-bidragsgivare.',
    '',
].join('\n');

test('releasens text: raden, versionens eget avsnitt och nedladdningen', () => {
    const parts = split(SAMPLE);
    assert.deepStrictEqual(parts.sections.map((s) => s.version), ['1.3', '1.2']);
    assert.strictEqual(notesFor(SAMPLE, '1.3'), [
        'Automatiskt byggd från commit `{{SHA}}`.', '',
        '## Nytt i 1.3', '', 'Det nyaste.', '', '- **Punkt:** text.', '  - underpunkt', '',
        'Det som var nytt i tidigare versioner står i deras releaser.', '',
        '## Windows', '- **ForensicsToolbox-{{VERSION}}-Installer.exe** — installer', '', 'Kartdata © OpenStreetMap-bidragsgivare.', '',
    ].join('\n'));
    assert.ok(!notesFor(SAMPLE, '1.2').includes('Det nyaste'), 'en äldre version får bara sitt eget avsnitt');
    assert.strictEqual(notesFor(SAMPLE, '1.4'), null, 'ett avsnitt som saknas');
});

test('releasens text: den riktiga filen har den senaste versionen och nedladdningen, och blir kort', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'release-notes.md'), 'utf8');
    const parts = split(text);
    assert.ok(parts.sections.length > 10);
    assert.match(parts.tail, /^## Windows/);
    const latest = parts.sections[0].version;
    const notes = notesFor(text, latest);
    assert.ok(notes.length < text.length / 5, 'texten är ' + notes.length + ' tecken av ' + text.length);
    assert.strictEqual((notes.match(/^## Nytt i /gm) || []).length, 1);
    assert.ok(notes.includes('## macOS') && notes.includes('{{VERSION}}'));
});

// GitHub läser ett snabel-a följt av ett namn som ett konto: kontot får ett meddelande och visas som medverkande i
// releasen. 1.57 fick ett främmande konto så, av WhatsApps id "@lid". Inom kodtecken läses det inte.
test('releasens text: inget snabel-a med ett namn efter utanför kodtecken', () => {
    const mentions = (s) => s.replace(/`[^`\n]*`/g, '').match(/(^|[^\w`])@[A-Za-z0-9][\w-]*/gm) || [];
    assert.deepStrictEqual(mentions('ett id (@lid) och a@b.se, cellen @, tabb'), ['(@lid']);
    assert.deepStrictEqual(mentions('ett id (`@lid`) och `@types/node`'), []);
    const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'release-notes.md'), 'utf8');
    assert.deepStrictEqual(mentions(text), [], 'sätt namnet inom kodtecken');
});
