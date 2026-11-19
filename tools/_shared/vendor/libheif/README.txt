# libheif (HEIC-avkodaren)

Forensics Toolbox ritar HEIC- och HEIF-bilder med libheif, kompilerat till WebAssembly. Chromium, som appen bygger
på, kan inte avkoda formatet själv.

| Fil | Vad |
|---|---|
| `libheif-worker.js` | `libheif-wasm/libheif-bundle.js` ur npm-paketet libheif-js och `scripts/libheif/worker-entry.js`, som källkod till en worker (`window.LIBHEIF_WORKER_SOURCE`). |
| `LICENSE-libheif-js.txt` | Licensen för libheif-js (GNU LGPL 3.0). |
| `LICENSE-libheif.txt` | Licenserna för libheif (GNU LGPL 3.0; exemplen MIT). |
| `VERSIONS.json` | Paketets version och integritet i npm, och SHA-256 för bundlen. |

## Vad som ingår

- **libheif** (LGPL-3.0), som läser HEIF-filen: <https://github.com/strukturag/libheif>
- **libde265** (LGPL-3.0), som avkodar HEVC-bilderna i den: <https://github.com/strukturag/libde265>
- **libheif-js** (LGPL-3.0), som bygger de två till WebAssembly: <https://github.com/catdad-experiments/libheif-js>

Versionen är libheif-js 1.23.5, hämtad från npm (<https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz>).
Källkoden till alla tre finns på adresserna ovan.

## Byta ut biblioteket

Avkodaren är en egen fil som laddas först när en HEIC ska visas (`tools/_shared/heic.js`). Den byggs om, eller
byts mot en annan version eller ett eget bygge, med

```
node scripts/vendor-libheif.js
```

efter att `VERSION` i skriptet har ändrats. Ett eget bygge av libheif-js läggs i stället för `libheif-bundle.js` i
skriptet. Den byggda filen ska ge globalen `libheif` som libheif-js gör. Sedan körs `npm test`.
