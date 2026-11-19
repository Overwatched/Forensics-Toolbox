'use strict';
// Bygger testfilen prov.heic: en HEIF-fil med en huvudbild på 64 × 48 och en förhandsbild på 32 × 24 som pekar på
// huvudbilden med en thmb-referens, som i en iPhone-bild. Bilderna är ffmpegs testbild (testsrc) kodad med libx265;
// HEIF-lådorna skrivs här. Ingår inte i bygget. Körs för hand när filen ska byggas om (kräver ffmpeg med libx265):
//
//   node tools/_shared/fixtures/make-heic.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OUT = path.join(__dirname, 'prov.heic');

function hevc(size, file) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=' + size + ':rate=1', '-frames:v', '1', '-pix_fmt', 'yuv420p',
        '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error:keyint=1', '-f', 'hevc', '-y', file], { stdio: ['ignore', 'ignore', 'ignore'] });
    const b = fs.readFileSync(file), at = [];
    for (let i = 0; i + 3 <= b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) at.push(i + 3);
    return at.map((s, k) => {
        let e = k + 1 < at.length ? at[k + 1] - 3 : b.length;
        while (e > s && b[e - 1] === 0) e--;
        return b.subarray(s, e);
    });
}

const u8 = (v) => Buffer.from([v & 255]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, flags, ...parts) => box(type, u8(version), u8(flags >> 16), u8(flags >> 8), u8(flags), ...parts);

// hvcC med VPS, SPS och PPS. Profilen (Main, nivå 3) räcker för libde265, som läser parametrarna ur NAL-enheterna.
function hvcC(nals) {
    const kind = (n) => (n[0] >> 1) & 63;
    const arrays = [32, 33, 34].map((t) => {
        const list = nals.filter((n) => kind(n) === t);
        return Buffer.concat([u8(0x80 | t), u16(list.length), ...list.map((n) => Buffer.concat([u16(n.length), n]))]);
    });
    return box('hvcC', u8(1), u8(0x01), u32(0x60000000), Buffer.from([0x90, 0, 0, 0, 0, 0]), u8(90), u16(0xf000), u8(0xfc), u8(0xfd), u8(0xf8), u8(0xf8), u16(0), u8(0x0f), u8(3), ...arrays);
}
const ispe = (w, h) => full('ispe', 0, 0, u32(w), u32(h));

function build() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-heic-'));
    try {
        const main = hevc('64x48', path.join(tmp, 'a.hevc')), small = hevc('32x24', path.join(tmp, 'b.hevc'));
        const vcl = (nals) => Buffer.concat(nals.filter((n) => ((n[0] >> 1) & 63) < 32).map((n) => Buffer.concat([u32(n.length), n])));
        const data = [vcl(main), vcl(small)];
        const ftyp = box('ftyp', Buffer.from('heic', 'latin1'), u32(0), Buffer.from('mif1heic', 'latin1'));
        const meta = (offsets) => full('meta', 0, 0,
            full('hdlr', 0, 0, u32(0), Buffer.from('pict', 'latin1'), u32(0), u32(0), u32(0), u8(0)),
            full('pitm', 0, 0, u16(1)),
            full('iloc', 0, 0, u8(0x44), u8(0x00), u16(2), ...[0, 1].map((k) => Buffer.concat([u16(k + 1), u16(0), u16(1), u32(offsets[k]), u32(data[k].length)]))),
            full('iinf', 0, 0, u16(2), ...[1, 2].map((id) => full('infe', 2, 0, u16(id), u16(0), Buffer.from('hvc1', 'latin1'), u8(0)))),
            box('iref', u8(0), u8(0), u8(0), u8(0), box('thmb', u16(2), u16(1), u16(1))),
            box('iprp', box('ipco', hvcC(main), ispe(64, 48), hvcC(small), ispe(32, 24)),
                full('ipma', 0, 0, u32(2), u16(1), u8(2), u8(0x81), u8(0x02), u16(2), u8(2), u8(0x83), u8(0x04))));
        // Förskjutningarna beror på metalådans storlek, som inte beror på deras värden.
        const head = ftyp.length + meta([0, 0]).length + 8;
        const file = Buffer.concat([ftyp, meta([head, head + data[0].length]), box('mdat', ...data)]);
        fs.writeFileSync(OUT, file);
        return file.length;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

if (require.main === module) console.log(OUT + ': ' + build() + ' byte');
module.exports = { OUT };
