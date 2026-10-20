// Visning av bild och video. Filen läses, men skrivs inte. Åtkomsttiden och
// ändringstiden ställs tillbaka om operativsystemet hann ändra dem.

const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'ftmedia';
const MAX_FULL = 80 * 1024 * 1024;
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
const originalTimes = new Map();
const chains = new Map();

function extOf(file) {
    return path.extname(file).slice(1).toLowerCase();
}

function reply(status, body, headers) {
    return new Response(body, { status: status, headers: Object.assign({ 'Cache-Control': 'no-store' }, CORS, headers) });
}

function exclusive(file, fn) {
    const prev = chains.get(file) || Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(file, run.then(function () {}, function () {}));
    return run;
}

// start/length är byte. noatime: false tvingar vägen som läser och ställer tillbaka tiden.
async function readPreservingTimes(file, start, length, opts) {
    opts = opts || {};
    const real = await fs.promises.realpath(file);
    return exclusive(real, async function () {
        const st = await fs.promises.stat(real);
        if (!st.isFile()) {
            const err = new Error('Inte en fil');
            err.code = 'EISDIR';
            throw err;
        }
        if (!originalTimes.has(real)) originalTimes.set(real, { atime: st.atime, mtime: st.mtime });
        const times = originalTimes.get(real);
        const startAt = Math.max(0, start);
        const len = Math.max(0, Math.min(length, st.size - startAt));
        const flags = fs.constants.O_RDONLY;
        const noatime = opts.noatime !== false && fs.constants.O_NOATIME;
        let handle = null;
        let restore = true;
        if (noatime) {
            try {
                handle = await fs.promises.open(real, flags | noatime);
                restore = false;
            } catch (err) {
                if (err.code !== 'EPERM' && err.code !== 'EINVAL' && err.code !== 'ENOTSUP') throw err;
            }
        }
        if (!handle) handle = await fs.promises.open(real, flags);
        try {
            const buf = Buffer.alloc(len);
            if (!len) return buf;
            const read = await handle.read(buf, 0, len, startAt);
            return buf.subarray(0, read.bytesRead);
        } finally {
            await handle.close();
            if (restore) await fs.promises.utimes(real, times.atime, times.mtime);
        }
    });
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
        originalTimes.delete(real);
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
        if (st.size > MAX_FULL) {
            return reply(416, 'För stor för en hel läsning', { 'Content-Range': 'bytes */' + st.size });
        }
        const body = await readPreservingTimes(real, 0, st.size);
        return reply(200, body, {
            'Content-Type': type,
            'Content-Length': String(body.length),
            'Accept-Ranges': 'bytes',
        });
    }
    const start = Number(range[1]);
    let end = range[2] ? Number(range[2]) : Math.min(st.size - 1, start + MAX_RANGE - 1);
    end = Math.min(end, st.size - 1, start + MAX_RANGE - 1);
    if (!(start <= end) || start >= st.size) {
        return reply(416, 'Utanför filen', { 'Content-Range': 'bytes */' + st.size });
    }
    const body = await readPreservingTimes(real, start, end - start + 1);
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
    readPreservingTimes: readPreservingTimes,
    mediaRequestHandler: mediaRequestHandler,
    handleMediaProtocol: handleMediaProtocol,
};
