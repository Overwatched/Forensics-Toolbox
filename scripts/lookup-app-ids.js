#!/usr/bin/env node
// Slår upp App Store-id och iOS bundle-id för frölistan i tools/app-ids/seeds.json.
// Skriver tools/app-ids/lookup-review.json. Rör inte katalogen.
//
// För varje frö: iTunes-sök → spår-id ur träffen → lookup?id=&country=
// hint måste finnas i namn eller utgivare. avoid diskvalificerar.
// Vid 403/429 väntar skriptet och försöker igen.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SEEDS = path.join(ROOT, 'tools', 'app-ids', 'seeds.json');
const CATALOG = path.join(ROOT, 'tools', 'app-ids', 'catalog.js');
const REVIEW = path.join(ROOT, 'tools', 'app-ids', 'lookup-review.json');
const UA = 'iTunes/12.6.2 (Macintosh; OS X 10.15)';
const PAUSE_MS = 500;

// Spår-id som klarade hint/avoid men var fel app. Tas inte med igen.
const FALSE_HITS = new Set([
    879115803, // Pensionsmyndighet Nyheter
    1473493711, // CV Maker & Arbetsförmedlingen
    517598197, // Jack Pott
    840776171, // HTX Mobile, flatexDEGIRO — inte kryptobörsen
    6807954675, // Jaxx-imitatör, bundle app.reverso.com
    6756636234, // Enkrypt-imitatör, inte MyEtherWallet
    1327938261, // Bitcoin-pristracker, inte Pocket Bitcoin
    650068726, // Scribblr Keyboard, inte Silence
    1632590589, // ungersk CoverMe-försäkring
    6738400489, // Confide Video Journal, inte messengern
]);

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function existingTrackIds() {
    const text = fs.readFileSync(CATALOG, 'utf8');
    const ids = new Set();
    const re = /trackId:\s*(\d+)/g;
    let match;
    while ((match = re.exec(text))) ids.add(Number(match[1]));
    return ids;
}

function existingIdsWithIos() {
    const catalog = require(path.join(ROOT, 'tools', 'app-ids', 'catalog.js'));
    const withIos = new Set();
    catalog.APPS.forEach(function (entry) {
        if (entry.ios && entry.ios.bundleId) withIos.add(entry.id);
    });
    return withIos;
}

async function itunes(url, attempt) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 403 || res.status === 429) {
        const wait = Math.min(30000, 2000 * (attempt + 1));
        console.error('itunes ' + res.status + ', väntar ' + wait + ' ms');
        await sleep(wait);
        if (attempt >= 4) throw new Error(String(res.status));
        return itunes(url, attempt + 1);
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}

function blobOf(result) {
    return ((result.trackName || '') + ' ' + (result.sellerName || '')).toLowerCase();
}

function pick(results, seed) {
    const hint = String(seed.hint || '').toLowerCase();
    const avoid = seed.avoid || [];
    return results.find(function (result) {
        const blob = blobOf(result);
        if (hint && blob.indexOf(hint) === -1) return false;
        return !avoid.some(function (word) { return blob.indexOf(String(word).toLowerCase()) !== -1; });
    });
}

async function lookupSeed(seed) {
    let country = 'se';
    let data = await itunes(
        'https://itunes.apple.com/search?term=' + encodeURIComponent(seed.term) + '&entity=software&country=se&limit=8',
        0
    );
    let results = data.results || [];
    if (!results.length) {
        country = 'us';
        data = await itunes(
            'https://itunes.apple.com/search?term=' + encodeURIComponent(seed.term) + '&entity=software&country=us&limit=8',
            0
        );
        results = data.results || [];
    }
    const chosen = pick(results, seed);
    if (!chosen) {
        return {
            status: 'rejected',
            id: seed.id,
            reason: 'ingen träff klarade hint/avoid',
            sample: results.slice(0, 3).map(function (result) { return result.trackName; }),
        };
    }
    await sleep(PAUSE_MS);
    const look = await itunes(
        'https://itunes.apple.com/lookup?id=' + chosen.trackId + '&country=' + country,
        0
    );
    const app = (look.results && look.results[0]) || chosen;
    if (!app.bundleId) {
        return { status: 'rejected', id: seed.id, reason: 'lookup saknade bundleId', trackName: app.trackName };
    }
    const looked = blobOf(app);
    const hint = String(seed.hint || '').toLowerCase();
    const avoid = seed.avoid || [];
    if (hint && looked.indexOf(hint) === -1) {
        return { status: 'rejected', id: seed.id, reason: 'lookup klarade inte hint', trackName: app.trackName, bundleId: app.bundleId };
    }
    if (avoid.some(function (word) { return looked.indexOf(String(word).toLowerCase()) !== -1; })) {
        return { status: 'rejected', id: seed.id, reason: 'lookup träffade avoid', trackName: app.trackName, bundleId: app.bundleId };
    }
    if (FALSE_HITS.has(app.trackId)) {
        return {
            status: 'rejected',
            id: seed.id,
            reason: 'känd felträff',
            trackId: app.trackId,
            trackName: app.trackName,
            bundleId: app.bundleId,
        };
    }
    return {
        status: 'accepted',
        id: seed.id,
        name: seed.name,
        category: seed.category,
        aliases: seed.aliases || [],
        android: seed.android || '',
        country: country,
        trackId: app.trackId,
        bundleId: app.bundleId,
        trackName: app.trackName,
        seller: app.sellerName,
    };
}

async function main() {
    const seeds = JSON.parse(fs.readFileSync(SEEDS, 'utf8'));
    const knownTracks = existingTrackIds();
    const withIos = existingIdsWithIos();
    const review = [];
    for (const seed of seeds) {
        if (withIos.has(seed.id)) {
            review.push({ status: 'skipped', id: seed.id, reason: 'finns redan med ios' });
            continue;
        }
        try {
            const row = await lookupSeed(seed);
            if (row.status === 'accepted' && knownTracks.has(row.trackId)) {
                review.push({ status: 'skipped', id: seed.id, reason: 'trackId finns redan', trackId: row.trackId });
            } else {
                review.push(row);
                if (row.trackId) knownTracks.add(row.trackId);
            }
            console.log((row.status || 'ok') + '\t' + seed.id + '\t' + (row.bundleId || row.reason || ''));
        } catch (err) {
            review.push({ status: 'error', id: seed.id, reason: String(err.message || err) });
            console.log('error\t' + seed.id + '\t' + (err.message || err));
        }
        await sleep(PAUSE_MS);
    }
    fs.writeFileSync(REVIEW, JSON.stringify(review, null, 2) + '\n');
    const accepted = review.filter(function (row) { return row.status === 'accepted'; }).length;
    console.log('lookup-app-ids: ' + accepted + ' godkända av ' + seeds.length + ' → ' + REVIEW);
}

main().catch(function (err) {
    console.error(err);
    process.exit(1);
});
