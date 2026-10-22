// Skapar de små JPEG-motiven till "Fyll med testdata" (tools/_shared/map/sample-jpegs.js)
// utifrån FILES i sample-data.js. Kör efter att testdatan ändrats:
//   node scripts/generate-sample-jpegs.js
// Varje bild visar enheten, platsen och sitt nummer bland enhetens bilder med position.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const sample = require('../tools/_shared/map/sample-data.js');

const OUT = path.join(__dirname, '../tools/_shared/map/sample-jpegs.js');
const COLORS = { Apple: '#0f488b', samsung: '#5a328b', none: '#45464f' };

function esc(s) {
    return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function svg(file, number) {
    const placed = file.lat && file.lon;
    const fill = placed ? COLORS[file.make] || COLORS.none : COLORS.none;
    const label = file.make === 'samsung' ? 'Testdata · Samsung' : 'Testdata';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">
<rect width="480" height="270" fill="${fill}"/>
<text x="24" y="42" font-family="Noto Sans, sans-serif" font-size="16" fill="#ffffff" fill-opacity="0.85">${esc(label)}</text>
<text x="408" y="54" font-family="Noto Sans, sans-serif" font-size="26" fill="#ffffff" text-anchor="middle">${placed ? number : '–'}</text>
<text x="24" y="130" font-family="Noto Sans, sans-serif" font-size="28" fill="#ffffff">${esc(file.place)}</text>
</svg>`;
}

async function main() {
    const counts = {};
    const out = {};
    for (const file of sample.files) {
        const placed = file.lat && file.lon;
        if (placed) counts[file.make] = (counts[file.make] || 0) + 1;
        const jpeg = await sharp(Buffer.from(svg(file, counts[file.make] || 0)))
            .jpeg({ quality: 70, chromaSubsampling: '4:2:0' })
            .toBuffer();
        out[file.name] = jpeg.toString('base64');
    }
    const body = Object.keys(out).map((name) => `    ${JSON.stringify(name)}: ${JSON.stringify(out[name])},`).join('\n');
    fs.writeFileSync(OUT, '// Små JPEG-motiv till "Fyll med testdata". EXIF läggs på i sample-data.js.\n' +
        '// Skapas av scripts/generate-sample-jpegs.js.\n' +
        '(function (root) {\n    root.SampleJpegs = {\n' + body + '\n    };\n' +
        '})(typeof window !== "undefined" ? window : globalThis);\n');
    console.log(Object.keys(out).length + ' bilder → ' + path.relative(process.cwd(), OUT));
}

main().catch((err) => { console.error(err); process.exit(1); });
