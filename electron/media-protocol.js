// Visning av bild och video. Filen öppnas bara för läsning och skrivs aldrig,
// inte heller tidsstämplarna. På Linux läses den med O_NOATIME så att åtkomsttiden
// står kvar. På macOS och Windows kan operativsystemet uppdatera åtkomsttiden;
// ändringstiden och ctime påverkas inte av en läsning.

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const SCHEME = 'ftmedia';
const MAX_RANGE = 8 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024 * 1024;

const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo',
};

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
};

const allowed = new Set();

function extOf(file) {
    return path.extname(file).slice(1).toLowerCase();
}

function reply(status, body, headers) {
    return new Response(body, { status: status, headers: Object.assign({ 'Cache-Control': 'no-store' }, CORS, headers) });
}

async function statFile(file) {
    const real = await fs.promises.realpath(file);
    const st = await fs.promises.stat(real);
    if (!st.isFile()) {
        const err = new Error('Inte en fil');
        err.code = 'EISDIR';
        throw err;
    }
    return { real: real, st: st };
}

// Öppnar bara för läsning. O_NOATIME finns bara på Linux och kräver att man äger filen;
// annars öppnas filen vanligt. Tiderna ställs aldrig tillbaka med utimes(): det skulle
// skriva till filen, tappa nanosekunder, ändra ctime och misslyckas på skrivskyddade diskar.
async function openForRead(real, opts) {
    const flags = fs.constants.O_RDONLY;
    const noatime = (opts || {}).noatime !== false && fs.constants.O_NOATIME;
    if (noatime) {
        try {
            return await fs.promises.open(real, flags | noatime);
        } catch (err) {
            if (err.code !== 'EPERM' && err.code !== 'EINVAL' && err.code !== 'ENOTSUP') throw err;
        }
    }
    return fs.promises.open(real, flags);
}

// start/length är byte.
async function readRange(file, start, length, opts) {
    const { real, st } = await statFile(file);
    const startAt = Math.max(0, start);
    const len = Math.max(0, Math.min(length, st.size - startAt));
    const handle = await openForRead(real, opts);
    try {
        const buf = Buffer.alloc(len);
        if (!len) return buf;
        const read = await handle.read(buf, 0, len, startAt);
        return buf.subarray(0, read.bytesRead);
    } finally {
        await handle.close();
    }
}

// Hela filen som ström, så att stora bilder (TIFF, HEIC) inte läses in i minnet på en gång.
async function streamFile(real, opts) {
    const handle = await openForRead(real, opts);
    return Readable.toWeb(handle.createReadStream({ autoClose: true }));
}

async function allow(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    let real;
    try { real = await fs.promises.realpath(filePath); }
    catch (err) { return false; }
    let st;
    try { st = await fs.promises.stat(real); }
    catch (err) { return false; }
    if (!st.isFile() || !MIME[extOf(real)] || st.size > MAX_FILE) return false;
    allowed.add(real);
    return true;
}

async function revoke(filePath) {
    try {
        const real = await fs.promises.realpath(filePath);
        allowed.delete(real);
        return true;
    } catch (err) {
        return false;
    }
}

async function mediaRequestHandler(request) {
    if (request.method === 'OPTIONS') return reply(204, null);
    let file = '';
    try { file = new URL(request.url).searchParams.get('p') || ''; }
    catch (err) { return reply(400, 'Ogiltig adress'); }
    let real;
    try { real = await fs.promises.realpath(file); }
    catch (err) { return reply(404, 'Filen saknas'); }
    if (!allowed.has(real)) return reply(403, 'Filen är inte öppnad för visning');
    const type = MIME[extOf(real)];
    if (!type) return reply(415, 'Inte en bild eller video');
    let st;
    try { st = await fs.promises.stat(real); }
    catch (err) { return reply(404, 'Filen saknas'); }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
    if (!range) {
        const body = await streamFile(real);
        return reply(200, body, {
            'Content-Type': type,
            'Content-Length': String(st.size),
            'Accept-Ranges': 'bytes',
        });
    }
    const start = Number(range[1]);
    let end = range[2] ? Number(range[2]) : Math.min(st.size - 1, start + MAX_RANGE - 1);
    end = Math.min(end, st.size - 1, start + MAX_RANGE - 1);
    if (!(start <= end) || start >= st.size) {
        return reply(416, 'Utanför filen', { 'Content-Range': 'bytes */' + st.size });
    }
    const body = await readRange(real, start, end - start + 1);
    return reply(206, body, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + (start + body.length - 1) + '/' + st.size,
        'Content-Length': String(body.length),
        'Accept-Ranges': 'bytes',
    });
}

function handleMediaProtocol() {
    require('electron').protocol.handle(SCHEME, mediaRequestHandler);
}

module.exports = {
    SCHEME: SCHEME,
    allow: allow,
    revoke: revoke,
    readRange: readRange,
    mediaRequestHandler: mediaRequestHandler,
    handleMediaProtocol: handleMediaProtocol,
};
