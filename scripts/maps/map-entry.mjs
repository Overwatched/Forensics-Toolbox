// Källa för tools/exif-viewer/vendor/maps/maplibre.js (byggs av scripts/vendor-maps.js).
// MapLibre 6 levereras bara som ES-moduler, som inte laddas under file://. Här blir
// biblioteket ett vanligt skript med window.maplibregl och window.pmtiles.

import * as maplibregl from 'maplibre-gl';
import { PMTiles, FileSource, FetchSource } from 'pmtiles';

window.maplibregl = maplibregl;
window.pmtiles = { PMTiles, FileSource, FetchSource };
