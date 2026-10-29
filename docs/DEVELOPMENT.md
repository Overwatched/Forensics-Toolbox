# Utveckling & bygg (Forensics Toolbox)

Lokal offline-verktygslåda för IT-forensik (Electron). Baserad på [CryptoToolbox](https://github.com/AdrianNeshad/CryptoToolbox).

## Förutsättningar

- **Node.js 20+** och npm  
  På Bazzite/Fedora: `brew install node`
- **unzip** (används av `postinstall` om Electron-binären saknas)
- Linux för lokal test; multi-OS-bygg via GitHub Actions (Windows + Linux + macOS)

## Snabbstart (Linux – rekommenderas under utveckling)

```bash
cd ~/Documents/Forensics-Toolbox
npm install
npm start
```

`npm start` kör Electron med `ELECTRON_RUN_AS_NODE` avstängt (annars kan appen krascha i vissa miljöer, t.ex. Cursor).

Öppna inte `Toolbox.html` direkt i Firefox/Chrome/Brave — `file://` blockerar ofta `src/style.css` och sidan ser ostylad ut. Appen är tänkt att köras via Electron (dev: `npm start`, användare: GitHub Releases).

### Om Electron klagar på saknad binär

```text
Error: Electron failed to install correctly...
```

Orsak: zip laddades ner men packades inte upp (förekommer med nyare Node, t.ex. v26).

```bash
npm run postinstall   # scripts/ensure-electron.js → unzip till node_modules/electron/dist
npm start
```

GPU/VSync-varningar i terminalen på Linux är oftast ofarliga.

## npm-skript

| Kommando | Syfte |
|----------|--------|
| `npm install` | Beroenden + `postinstall` (säkerställ Electron-binär) |
| `npm start` | Kör appen live (Linux-test) |
| `npm run postinstall` | Packa upp/ladda Electron-binär vid behov |
| `npm run pack:linux` | Snabb Linux-dir under `release/` |
| `npm run dist:linux` | Linux AppImage (+ dir) → `release/` |
| `npm run fetch-maps` | Hämtar offlinekartorna till `maps/` (krävs före `dist*`, se Kartor) |
| `npm run dist` / `dist:win` | Windows NSIS + portabel zip (kör på **Windows** eller CI) |
| `npm run dist:portable` | Endast portabel zip |
| `npm run dist:installer` | Endast NSIS-installer |
| `npm run sync-version` | Synkar version från `Toolbox.html` → `package.json` |

## Windows-build (målplattform)

Cross-build från en enda maskin är opålitligt. Använd:

1. **GitHub Actions** – `.github/workflows/build-release.yml` bygger **Windows + Linux + macOS** parallellt (matrix) vid push till `main` (ignorerar rena `.md`-ändringar), eller  
2. Lokalt: `npm run dist` (Windows), `npm run dist:linux`, `npm run dist:mac`

Artifacts (efter finalize / CI):

- `ForensicsToolbox-X.Y-Portable.zip` (packa upp och kör `Forensics Toolbox.exe`)
- `ForensicsToolbox-X.Y-Installer.exe`

Portabel Windows är en zip i stället för en självuppackande `.exe`: med kartorna är appen
runt 1,5 GB, och en portabel `.exe` packar upp allt till en tempmapp vid varje start.

CI skapar releasen som utkast, låter varje byggjobb ladda upp sina filer direkt (alla
filer får inte plats på ett enda jobbs disk) och publicerar när alla jobb är klara.
Releasetexten kommer från `.github/release-notes.md`.
En release som redan är publicerad rörs inte: en push utan ny version bygger inget.
Två körningar åt gången köas (`concurrency`).

Versionen läses från texten `Version X.Y` i `Toolbox.html`.

## Projektstruktur

```text
Toolbox.html          # Hub / sidopanel
electron/main.js      # Electron-shell
electron/preload.js   # Brygga till verktygen (bara file://-ramar): forensicsDesktop, forensicsMedia
electron/map-protocol.js    # ftmaps:// — kartfiler i maps/
electron/media-protocol.js  # ftmedia:// — bild och video i EXIF-visaren
src/                  # Delad UI (tema, navigation)
tools/_shared/        # Delat verktygs-skal (toolkit.js: temahantering)
tools/<namn>/         # Ett verktyg per mapp (HTML/JS/CSS)
documentation/        # Referens / guider i iframe
queries/              # SQL-mallar (catalog.json är källan, catalog.js genereras); dolda rollqueryer för Härkomst
maps/                 # kartdata.json (incheckad) + *.pmtiles (hämtas, gitignorerade)
scripts/              # sync-version, sync-queries, vendor-exiftool, vendor-maps, kartdata, ensure-electron, finalize-artifacts
```

### Query-kataloger

`queries/**/catalog.json` är källan. Queries-verktyget läser `catalog.js`, eftersom
`fetch()` av JSON blockeras under `file://`. Kör `npm run sync-queries` efter varje
ändring i en `catalog.json`; testet larmar om filerna skiljer sig.

Photos.sqlite-mallarna är indelade i band efter schema: iOS 10–13 (`ZGENERICASSET`),
iOS 14 (`ZASSET`), iOS 15–16 och iOS 17+ (skaparappen i `ZIMPORTEDBYBUNDLEIDENTIFIER`).
`tools/db-queries/photos-catalog.test.js` kör varje mall mot de tabeller och kolumner
som iLEAPP läser för iOS 11–13, 14, 15, 16, 17, 18 och 26
(`tools/db-queries/fixtures/photos-schema.json`). Ny iOS-version i iLEAPP:

```bash
git clone --depth 1 https://github.com/abrignoni/iLEAPP /tmp/iLEAPP
# lägg till REF-filen i scripts/photos-schema-from-ileapp.js
node scripts/photos-schema-from-ileapp.js /tmp/iLEAPP/scripts/artifacts
npm test
```

### Härkomst (`tools/provenance/`)

Tidslinje och bedömning för en bildfil. Verktyget har ingen egen SQL: det hämtar dolda
rollqueryer ur katalogerna (`hidden: true`, `role`, `epoch`, `fields`), kör dem mot databaserna
i extraktionen med `-wal` pålagd, och bygger en händelselista i UTC.

- `roles.js` samlar rollerna per källa och Photos-band och fyller i platshållarna med tal.
- `timeline-core.js` avgör typ av fil (kamerabild, skärmdump, sparad ur app), bedömer
  skapandetid, app igång, kamera igång och skärm som stöd, motsägelse eller saknas, och har
  förklaringens ordförråd. Allt testas i Node.
- `timeline-svg.js` ritar tidslinjen, `report.js` bygger protokollet och förklaringen som HTML
  med inline-stilar för Word.
- Extraktionen läses med `tools/db-queries/extraction-core.js`, som Queries också använder. Bara
  läsning: testet i `zip.test.js` grep:ar alla filer i `tools/provenance/` efter skrivande API:er.
- Bildfilen läses ur zippen och ExifTool-workern från EXIF & karta laddas först när den behövs.
- Positionerna (bildens enligt databasen och EXIF, telefonens enligt routined) visas i en tabell
  och på den delade kartvyn med nålar. Kartbilden hämtas med `mapView.toImage()` och läggs i
  båda exporterna. Kartans laddning kräver att fönstret ritas: med låst skärm kommer ingen
  bildruta, och då går exporten vidare utan kartbild efter tio sekunder.
- På iOS kommer app och kamera ur knowledgeC `/app/usage` (`/app/inFocus` finns inte på iOS 18
  och senare, bara som reserv). På Android ur Wellbeing; skärm och lås saknas där.

Plan och provkörning: [PLAN-harkomst.md](PLAN-harkomst.md).

#### Snapchat och "Var finns filen?" (beta)

- `queries/ios/snapchat/catalog.json` har fyra databaser som hittas på **suffix** i appens behållare
  (GUID:t varierar): `Documents/global_scoped/cachecontroller/cache_controller.db`, `arroyo/arroyo.db`,
  `DocObjects/primary.docobjects` och `databases/nse_db.sqlite`. Synliga queries för manuell kontroll
  i Queries, dolda rollqueries för Härkomst. Tiderna är Unix-millisekunder (`{{unixMsStart}}`).
- `tools/provenance/snapchat.js` tolkar `EXTERNAL_KEY` (`1:<konversation>:<server_message_id>:0:0`
  = chattmedia, `<UUID>~1` = inspelning med Snapchats kamera, `ANVÄNDARNAMN~<UUID>` = skickad snap),
  typkoderna i `MEDIA_CONTEXT_TYPE`, och protobufen: avsändaren är fält 2 → fält 1 (16 byte) i
  `message_content`, samma bytes som `hex(substr(message_content, 7, 16))` i den synliga queryn.
  Användarnamn läses ur `snapchatter.p`, som är en FlatBuffer (längdprefixade strängar i klartext).
  Det egna kontot står i mappnamnet `file_manager_3_SCContent_<uuid>`.
- `tools/provenance/copies.js`: dubbletter på storlek + CRC32 ur innehållsförteckningen
  (`ZipRead.scan` ger `keep(namn, storlek, crc32)`), bekräftade med SHA-256, och platsens betydelse.
- Flödet: ingen rad i Photos → filnamnet söks i hela zippen → ligger filen i Snapchats cache blir
  T `CREATION_TIMESTAMP_MILLIS` och typen *Snapchat-media utanför bildbiblioteket*; annars EXIF-tid
  eller zippens ändringstid. "Välj filen från disk" räknar CRC32 på filen och söker zippen.
- Faktorerna för Snapchat-filer: *Snapchat igång* (appens egen registerrad vid T, plus knowledgeC),
  *Snapchats kamera* (typ 34, eller en inspelning strax före en skickad snap; mottagen = inte tillämplig).
- Allt är kontrollerat mot **en** extraktion (K12345-26, iOS 18.5). Därför beta: märkt i gränssnittet,
  i protokollet och i katalogens `sourceNote`.

### ExifTool i EXIF-visaren

`tools/exif-viewer/vendor/exiftool/` byggs av `node scripts/vendor-exiftool.js` från
fastlåsta npm-paket (`@uswriting/exiftool`, `@6over3/zeroperl-ts`). Skriptet bygger
workern från `scripts/exiftool/worker-entry.mjs` med esbuild och lägger in
`zeroperl.wasm` gzippad som base64, så att inget hämtas under `file://`. Bara
`parseMetadata` importeras; skrivfunktionen finns inte i bundlen.
`exif-vendor.test.js` kontrollerar wasm-filens SHA-256 och läser en riktig bild med
workern. Byt version genom att ändra `PACKAGES` i skriptet och köra det igen.

### Kartor i EXIF & karta

Kartan delas av EXIF & karta och Positioner. Koden ligger i `tools/_shared/map/`
(`map-core.js`, `map-view.js`, `import-core.js`, `vendor/maps/`). `ToolboxMap.create({ host })`
bygger panelen själv. Positioner läser GPX, KML, CSV, GeoJSON, Google-tidslinje och
inklistrade koordinater. EXIF & karta kan skicka synliga positioner dit via hubben.

Kartvyn (`map-view.js`, logik i `map-core.js`) använder MapLibre GL och Protomaps
vektorkartor i PMTiles-format.

- **Bibliotek, stil, typsnitt och ikoner:** `tools/exif-viewer/vendor/maps/` byggs av
  `node scripts/vendor-maps.js` från fastlåsta npm-paket och en fastlåst commit av
  `protomaps/basemaps-assets`. Allt bäddas in i `.js`-filer (ingen `fetch()` under
  `file://`), och MapLibre-workern körs från en Blob-URL. `map-vendor.test.js`
  kontrollerar hashar mot `VERSIONS.json` och att offlinestilen saknar URL:er.
- **Kartdata:** `maps/world.pmtiles` (hela världen, zoom 0–6, 45 MB) och
  `maps/sweden.pmtiles` (Sverige, zoom 7–14, 1,3 GB) är för stora för git. De ligger
  som filer i en egen GitHub-release (`kartdata-ÅÅÅÅMMDD`, förhandsversion).
  `maps/kartdata.json` pekar ut releasen och filernas SHA-256.
  `npm run fetch-maps` hämtar och verifierar dem; CI gör samma sak före bygget.
- **Ny kartdata:** installera [pmtiles-CLI:t](https://github.com/protomaps/go-pmtiles),
  kör `node scripts/build-map-data.js` (senaste Protomaps-bygget, eller ett datum
  `ÅÅÅÅMMDD`) och ladda upp filerna med kommandot som skriptet skriver ut. Sveriges
  gräns finns i `scripts/maps/sweden-region.geojson`. Checka in den nya `kartdata.json`.
- **I appen:** `electron/map-protocol.js` serverar `maps/` som `ftmaps://data/<fil>` med
  Range-stöd, så att kartan bara läser de delar av filen som behövs. Endast filnamn som
  `namn.pmtiles`/`namn.json` direkt i `maps/` lämnas ut.
- **Bakgrund: Karta, Satellit och Hybrid.** Satellit och Hybrid kräver en bildkarta: en
  `.pmtiles`-fil med bildrutor (png, jpeg eller webp), till exempel flygfoton. Filen läggs i
  `maps/` (skrivbordsappen listar mappen via `ftmaps://list/`, HTML-versionen tar med alla
  `.pmtiles` i den valda mappen) eller väljs med "Lägg till bildkarta…". Bilderna ritas ovanpå
  vektorkartan, så kartan syns där bilderna tar slut. Hybrid lägger vägar, gränser och namn
  ovanpå bilden. Stilen byggs av `MapCore.basemapStyle()` och testas i `map-core.test.js`.
  Rutstorleken (256 eller 512 px) läses från en avkodad ruta. Från en GeoTIFF med GDAL och
  pmtiles-CLI:t:

  ```bash
  gdal_translate -of MBTILES ortofoto.tif ortofoto.mbtiles   # projiceras om till webbmercator
  gdaladdo -r average ortofoto.mbtiles 2 4 8 16              # lägre zoomnivåer
  pmtiles convert ortofoto.mbtiles ortofoto.pmtiles
  ```

  Filnamnet får bestå av bokstäver a–z, siffror, `-` och `_`.
- **Onlinekarta (OpenFreeMap):** kräver att användaren godkänner det varje session.
  Bara kartrutor för området som visas hämtas; filer, sökvägar och metadata skickas
  aldrig. Electron tar bort appnamnet ur User-Agent och Referer/Cookie ur alla
  externa anrop.
- **HTML-versionen** har ingen `ftmaps://`. Kartfilerna packas med i mappen `maps`.
  En dubbelklickad `Toolbox.html` får inte läsa den mappen själv, så användaren
  väljer mappen `maps` i kartan. Webbläsaren läser då filerna i bitar, utan server.
  Onlinekartan fungerar som i skrivbordsappen.

### Bild och video i EXIF-visaren (`ftmedia://`)

EXIF-visaren visar innehållet via `ftmedia://view/?p=<sökväg>`. Bara filer som en sida i
appen först har öppnat med `forensicsMedia.allow()` lämnas ut, och bara till `file://`-sidor.
Filen öppnas skrivskyddat och skrivs aldrig, inte heller tidsstämplarna (ingen `utimes()`).
På Linux läses den med `O_NOATIME`, så att åtkomsttiden står kvar. På macOS och Windows kan
operativsystemet uppdatera åtkomsttiden; mtime och ctime påverkas inte. Hela filer skickas
som ström, utan storleksgräns, och `Range` ger högst 8 MB per svar.
`tools/exif-viewer/media-times.test.js` kontrollerar mtime och ctime på nanosekunden.

Iframes får inte navigera till webbsidor (`will-frame-navigate`); en länk öppnas i stället
i webbläsaren.

### Lägga till ett verktyg

1. Skapa `tools/<namn>/` med HTML (+ ev. JS/CSS)
2. Ladda det delade skalet i `<head>` före verktygets `style.css`: `<script src="../_shared/toolkit.js"></script>`. Det sätter temat (från förälderns `?theme=`/`postMessage`) innan sidan målas — duplicera inte tema-koden per verktyg. Lyssnar verktyget på andra meddelanden (t.ex. `select-db`) behåller det sin egen lyssnare för just dem.
3. Lägg till knapp i `Toolbox.html`: `data-type="frame"` och `data-src="tools/<namn>/..."`

## Tester

- `npm test` letar upp alla `tools/**/*.test.js` via `scripts/run-tests.js` och kör dem
  med Nodes inbyggda testkörare (inga beroenden). Filerna skickas som explicita
  argument, eftersom `node --test` tolkar glob-mönster och kataloger olika i olika
  Node-versioner
- CI kör samma kommando i ett eget jobb **innan** bygget, så en trasig avkodning
  eller hashimplementation aldrig når en release
- `tools/hash-calculator/hashing.test.js` jämför de rena JS-implementationerna mot
  Nodes `crypto` för längder runt varje blockgräns, och verifierar att resultatet
  är oberoende av hur indata delas upp i bitar
- Testdata ligger i `tools/**/fixtures/` och tas inte med i bygget
- "Fyll med testdata" i Härkomst kommer från `tools/provenance/sample-data.js`: samma promenad,
  bilden IMG_4104.JPG vid Sergels torg mitt i en Snapchat-session, med påhittade knowledgeC-rader.
  "Testdata: Snapchat" är `snapchatScenario()` i samma fil: videon Anna spelar in med Snapchats
  kamera 14:38:16 och skickar till Erik, utan rad i Photos.sqlite, med cachenyckeln som filnamn
  och kopior i recorded_videos och Library/Caches. Båda scenarierna delar telefonloggen
  (`phoneLog()`) och Snapchats register (`snapchatContext()`), så historien hänger ihop
- "Fyll med testdata" i kartverktygen kommer från `tools/_shared/map/sample-data.js`. Positionerna
  ligger på gator i offlinekartan (rutterna korsar vatten bara på broar). Ändras filerna där, kör
  `node scripts/generate-sample-jpegs.js` så att bildmotiven (`sample-jpegs.js`) följer med

## Versionering

- Visa version i hubben: `Version 1.1` i `Toolbox.html`
- `sync-version` sätter `package.json` till `1.1.0` (semver för electron-builder)
- Höj versionen i `Toolbox.html` innan release/push om du vill ha ny GitHub Release-tagg
- `npm run pack-html` skapar `release/ForensicsToolbox-X.Y-html.zip` (Toolbox.html utan exe, med kartfiler om de finns i `maps/`)

## Kända begränsningar

- Offline för lokala verktyg; externa länkar/nedladdningar och onlinekartan kräver nät och bekräftelse
- Windows-signing är avstängd (`signExecutable: false`). Ikon och metadata skrivs ändå in i exe-filen.
- `npm audit`-varningar i Electron-kedjan är vanliga; åtgärda inte med `audit fix --force` utan översikt
- Härkomst: Android-delen är oprövad (ingen extraktion med bilder fanns), skärm och lås saknas på Android (Wellbeing loggar dem inte), bildfiler över 200 MB läses inte för EXIF, och inklistringen i Word är provkörd bara via urklippsstatus, inte i Word självt
- **Snapchat (beta):** typkoder och protobuf-tolkning är härledda ur en enda extraktion. Memories
  (`gallery.encrypteddb`) är SQLCipher och läses inte. Chattmedia är ofta krypterat på disk; nyckel och
  IV ligger i `message_content` men används inte. Flera Snapchat-konton i samma behållare: första
  träffen används. Android-Snapchat är inte kontrollerat.
