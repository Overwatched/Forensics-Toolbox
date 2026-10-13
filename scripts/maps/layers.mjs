// Skriver Protomaps-stilens lager för ljust och mörkt tema som JSON på stdout.
// Körs av scripts/vendor-maps.js i den tillfälliga npm-mappen.

import { layers, namedFlavor } from '@protomaps/basemaps';

const out = {};
for (const flavor of ['light', 'dark']) {
    out[flavor] = layers('protomaps', namedFlavor(flavor), { lang: 'sv' });
}
process.stdout.write(JSON.stringify(out));
