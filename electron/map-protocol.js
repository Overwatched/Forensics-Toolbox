// Offlinekartor: serverar filerna i maps/ via ftmaps://data/<namn>, med Range-stöd så att
// MapLibre bara läser de delar av en kartfil (.pmtiles) som visas. fetch() mot file://
// fungerar inte i Chromium, därför ett eget schema.

const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'ftmaps';
const NAME = /^[a-z0-9][a-z0-9-]*\.(pmtiles|json)$/;
const MAX_RANGE = 64 * 1024 * 1024;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag',
};

// Måste köras innan app är redo.
// electron läses in här och inte överst, så att mapRequestHandler kan testas i Node.
function registerMapScheme() {
    require('electron').protocol.registerSchemesAsPrivileged([{
        scheme: SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    }]);
}

function reply(status, body, headers) {
    return new Response(body, { status, headers: Object.assign({}, CORS, headers) });
}

async function readRange(file, start, end) {
    const handle = await fs.promises.open(file, 'r');
    try {
        const buf = Buffer.alloc(end - start + 1);
        const { bytesRead } = await handle.read(buf, 0, buf.length, start);
        return buf.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

function mapRequestHandler(dir) {
    return async (request) => {
        if (request.method === 'OPTIONS') return reply(204, null);
        const url = new URL(request.url);
        const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        if (url.host !== 'data' || !NAME.test(name)) return reply(404, 'Okänd kartfil');
        const file = path.join(dir, name);
        let stat;
        try {
            stat = await fs.promises.stat(file);
        } catch (err) {
            return reply(404, 'Kartfilen saknas');
        }
        const etag = '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
        const type = name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
        const m = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
        if (!m) {
            if (stat.size > MAX_RANGE) return reply(416, 'Range krävs', { 'Content-Range': 'bytes */' + stat.size });
            return reply(200, await fs.promises.readFile(file), { 'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: etag });
        }
        const start = Number(m[1]);
        const end = Math.min(m[2] ? Number(m[2]) : stat.size - 1, stat.size - 1, start + MAX_RANGE - 1);
        if (start > end) return reply(416, 'Utanför filen', { 'Content-Range': 'bytes */' + stat.size });
        const body = await readRange(file, start, end);
        return reply(206, body, {
            'Content-Type': type,
            'Content-Range': 'bytes ' + start + '-' + (start + body.length - 1) + '/' + stat.size,
            'Content-Length': String(body.length),
            'Accept-Ranges': 'bytes',
            ETag: etag,
        });
    };
}

function handleMapProtocol(dir) {
    require('electron').protocol.handle(SCHEME, mapRequestHandler(dir));
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Onlinekartan: karttjänsten ska se vilka kartrutor som hämtas, men inte att förfrågan
// kommer från en forensisk verktygslåda. Electron lägger annars appnamn och version i
// User-Agent.
// Electron lägger till appnamnet (utan mellanslag i paketerad app, paketnamnet under
// utveckling) och Electron/x. Bara de token som en vanlig Chrome skickar får vara kvar.
const UA_TOKENS = new Set(['Mozilla', 'AppleWebKit', 'Chrome', 'Safari']);

function genericUserAgent(ua, appNames) {
    let out = ua;
    for (const name of appNames) out = out.replace(new RegExp(' ' + escapeRegExp(name) + '/\\S+'), '');
    return out.replace(/ ([A-Za-z][\w.-]*)\/\S+/g, (token, name) => (UA_TOKENS.has(name) ? token : ''));
}

function stripIdentifyingHeaders(session) {
    session.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        const headers = Object.assign({}, details.requestHeaders);
        for (const key of Object.keys(headers)) {
            if (/^(referer|cookie)$/i.test(key)) delete headers[key];
        }
        callback({ requestHeaders: headers });
    });
}

module.exports = {
    SCHEME, registerMapScheme, handleMapProtocol, mapRequestHandler, genericUserAgent, stripIdentifyingHeaders,
};
