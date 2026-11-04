// Lägger -wal-filens ramar på en kopia av databasen i minnet, så att en query ser samma
// innehåll som SQLite skulle se på telefonen. Källfilerna ändras aldrig.
//
// Bara ramar med rätt salt och obruten checksumma räknas, och bara fram till sista
// commit. Ramar efter den hör till en transaktion som aldrig blev klar. Testas i Node.
(function (root) {
    'use strict';

    var MAGIC_LE = 0x377f0682;
    var MAGIC_BE = 0x377f0683;
    var WAL_HEADER = 32;
    var FRAME_HEADER = 24;

    function u32(bytes, at) {
        return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }

    // SQLite:s checksumma: ord i par, s0 += x0 + s1, s1 += x1 + s0. Ordens byteordning
    // följer magiska talet i WAL-huvudet.
    function checksum(bytes, start, end, bigEndian, s) {
        var s0 = s[0];
        var s1 = s[1];
        for (var i = start; i < end; i += 8) {
            var x0, x1;
            if (bigEndian) {
                x0 = u32(bytes, i);
                x1 = u32(bytes, i + 4);
            } else {
                x0 = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
                x1 = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
            }
            s0 = (s0 + x0 + s1) >>> 0;
            s1 = (s1 + x1 + s0) >>> 0;
        }
        return [s0, s1];
    }

    function readHeader(wal) {
        if (!wal || wal.length < WAL_HEADER) return { error: 'För kort för att vara en -wal-fil' };
        var magic = u32(wal, 0);
        if (magic !== MAGIC_LE && magic !== MAGIC_BE) return { error: 'Ingen -wal-fil (fel magiskt tal)' };
        var bigEndian = magic === MAGIC_BE;
        var pageSize = u32(wal, 8);
        if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) return { error: 'Ogiltig sidstorlek i -wal' };
        var sum = checksum(wal, 0, 24, bigEndian, [0, 0]);
        if (sum[0] !== u32(wal, 24) || sum[1] !== u32(wal, 28)) return { error: 'Fel checksumma i -wal-huvudet' };
        return {
            bigEndian: bigEndian,
            pageSize: pageSize,
            checkpoint: u32(wal, 12),
            salt1: u32(wal, 16),
            salt2: u32(wal, 20),
            sum: sum,
        };
    }

    function dbPageSize(db) {
        if (!db || db.length < 100) return 0;
        var raw = (db[16] << 8) | db[17];
        return raw === 1 ? 65536 : raw;
    }

    // Vilka ramar som ska läggas på: { stats, frames: [{ page, at }], commitPages, pageSize }. Ramarna
    // gäller bara om frames inte är tom. Kontrollsummorna gäller ramarna som de står i filen.
    function plan(db, wal) {
        var stats = {
            walFrames: 0, validFrames: 0, appliedFrames: 0, ignoredFrames: 0,
            uncommittedFrames: 0, oldFrames: 0, brokenFrames: 0,
            commits: 0, pages: 0, error: '',
        };
        var none = { stats: stats, frames: [], commitPages: 0, pageSize: 0 };
        // En tom -wal (0 byte) är det vanliga läget efter en checkpoint: inga ramar att lägga på.
        if (!wal || !wal.byteLength) {
            stats.empty = true;
            return none;
        }
        wal = wal instanceof Uint8Array ? wal : new Uint8Array(wal);
        var head = readHeader(wal);
        if (head.error) {
            stats.error = head.error;
            return none;
        }
        var pageSize = head.pageSize;
        var dbSize = dbPageSize(db);
        if (dbSize && dbSize !== pageSize) {
            stats.error = 'Sidstorleken i -wal (' + pageSize + ') stämmer inte med databasen (' + dbSize + '). Fel -wal-fil?';
            return none;
        }

        var frameSize = FRAME_HEADER + pageSize;
        stats.walFrames = Math.floor((wal.length - WAL_HEADER) / frameSize);
        var sum = head.sum;
        var pending = [];
        var committed = [];
        var commitPages = 0;
        // Efter en checkpoint skriver SQLite om -wal från början. Ramar längre bak har då
        // salt från en äldre omgång: de är redan överförda eller överskrivna och räknas inte.
        var stop = '';
        for (var f = 0; f < stats.walFrames; f++) {
            var at = WAL_HEADER + f * frameSize;
            if (u32(wal, at + 8) !== head.salt1 || u32(wal, at + 12) !== head.salt2) { stop = 'old'; break; }
            var next = checksum(wal, at, at + 8, head.bigEndian, sum);
            next = checksum(wal, at + FRAME_HEADER, at + frameSize, head.bigEndian, next);
            if (next[0] !== u32(wal, at + 16) || next[1] !== u32(wal, at + 20)) { stop = 'broken'; break; }
            sum = next;
            stats.validFrames++;
            pending.push({ page: u32(wal, at), at: at + FRAME_HEADER });
            var commitSize = u32(wal, at + 4);
            if (commitSize) {
                for (var c = 0; c < pending.length; c++) committed.push(pending[c]);
                pending = [];
                commitPages = commitSize;
                stats.commits++;
            }
        }
        stats.appliedFrames = committed.length;
        stats.ignoredFrames = stats.walFrames - committed.length;
        stats.uncommittedFrames = stats.validFrames - committed.length;
        if (stop === 'old') stats.oldFrames = stats.walFrames - stats.validFrames;
        if (stop === 'broken') stats.brokenFrames = stats.walFrames - stats.validFrames;
        return { stats: stats, frames: committed, commitPages: commitPages, pageSize: pageSize };
    }

    // Returnerar { bytes, stats }. bytes är en ny Uint8Array; db och wal lämnas orörda.
    // opts.page(bytes, sidnummer) -> bytes: körs på varje sida som läggs på, t.ex. för att
    // dekryptera en SQLCipher-sida. opts.plan: en färdig plan(db, wal), så att den inte räknas igen.
    // opts.owned: db behövs inte efteråt och får skrivas över, eftersom en kopia av en stor databas är
    // det som tar slut på minnet. Är db en vy in i något större, till exempel källan, görs kopian ändå.
    function apply(db, wal, opts) {
        db = db instanceof Uint8Array ? db : new Uint8Array(db);
        var planned = opts && opts.plan || plan(db, wal);
        var stats = planned.stats;
        var committed = planned.frames;
        var owned = !!(opts && opts.owned) && db.byteLength === db.buffer.byteLength;
        if (!committed.length) return { bytes: unWal(owned ? db : db.slice()), stats: stats };
        wal = wal instanceof Uint8Array ? wal : new Uint8Array(wal);
        var pageSize = planned.pageSize;
        var commitPages = planned.commitPages;

        var size = commitPages * pageSize;
        var out = owned && size <= db.length ? db.subarray(0, size) : new Uint8Array(size);
        if (out.buffer !== db.buffer) out.set(db.subarray(0, Math.min(db.length, size)));
        var touched = {};
        var transform = opts && opts.page;
        committed.forEach(function (fr) {
            if (fr.page < 1 || fr.page > commitPages) return;
            var page = wal.subarray(fr.at, fr.at + pageSize);
            out.set(transform ? transform(page, fr.page) : page, (fr.page - 1) * pageSize);
            touched[fr.page] = true;
        });
        stats.pages = Object.keys(touched).length;
        return { bytes: unWal(out), stats: stats };
    }

    // Byte 18 och 19 = 2 betyder WAL-läge. I minnet ska databasen öppnas som en vanlig fil,
    // annars letar SQLite efter en -wal som inte finns där.
    function unWal(bytes) {
        if (bytes.length >= 100 && bytes[18] === 2 && bytes[19] === 2) {
            bytes[18] = 1;
            bytes[19] = 1;
        }
        return bytes;
    }

    var api = { apply: apply, plan: plan, readHeader: readHeader };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SqliteWal = api;
})(typeof window !== 'undefined' ? window : this);
