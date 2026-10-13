# Plan: Kartan, version 2 (efter 1.7)

Arbetsplan för nästa omgång. Bygg i stegen nedan, i den ordningen. Varje steg ska
fungera och vara committat innan nästa påbörjas.

## Regler som gäller hela vägen

- **EXIF och filer ändras aldrig.** Allt är läsning. "Ta bort" betyder ta bort ur listan.
- **Inget nätverk** utöver onlinekartan (OpenFreeMap, kräver godkännande) och de externa
  länkarna som redan finns. Inga nya CDN-, typsnitts- eller API-anrop.
- **Bryt inget som finns.** Tabell, filter, sökning, tidsfilter, detaljvy, export
  (CSV/JSON/KML/GeoJSON), kluster, popup, rutt, onlinekarta och tema ska fungera som
  i 1.7 efter varje steg.
- **Inte rörigt.** Ny funktion ska ligga där användaren väntar sig den, med få och
  tydliga kontroller. Hellre en välgjord funktion än tre halvfärdiga.
- **Kodstil:** samma som runt omkring. UMD-moduler (`root.X = factory()`) för ren
  logik så att den går att testa i Node, svenska texter i UI och kommentarer, inga
  ramverk och inga byggsteg för verktygen. Fil- och mappnamn på engelska.
- Allt under `file://` i Electron: ingen `fetch()` av lokala filer och inga ES-moduler.
  Kartfiler läses via `ftmaps://data/<fil>` (se `electron/map-protocol.js`).
- Ren logik får tester i `*.test.js` bredvid koden (`npm test` hittar alla under `tools/`).
  Testdata läggs i en `fixtures/`-mapp (tas inte med i bygget).
- Arbeta på en egen gren per steg (`cursor/<namn>`). **Pusha inte och skapa ingen
  release** förrän användaren ber om det.

Testmaterial: `~/Documents/Testbilder karta/` (22 filer, beskrivs i `LÄS MIG.txt`).
Promenad i Stockholm, kväll på Djurgården, nästa dag på Södermalm, tre Samsung-bilder
på samma plats utan tidszon, en video, och filer utan position eller med position 0,0.

---

## Steg 1 — Kartan fyller hela den tillgängliga ytan

**Varför den kapas i dag:** `tools/exif-viewer/style.css` begränsar allt:
`body { padding: 36px 24px 80px }`, `#container { max-width: 1240px; margin: 0 auto }`,
och `.map-wrap { height: max(420px, calc(100vh - 340px)) }`. Kartan centreras därför
som en 1240 px bred ruta under rubriken, släppytan, filterchippen och verktygsraden.

**Gör så här:**

1. I `setView()` i `script.js`: `document.body.classList.toggle('map-mode', view === 'map')`.
2. CSS för `body.map-mode`:
   - `body`: `height: 100vh; padding: 12px 16px; overflow: hidden`.
   - `#container`: `max-width: none; height: 100%; display: flex; flex-direction: column`.
   - Dölj ingressen (`.page-header p`) och gör rubriken mindre.
   - Släppytan blir en kompakt rad (bara knapparna "Lägg till mapp" och "Lägg till
     filer" och motorstatus), klass `.drop.compact`. Det ska fortfarande gå att
     dra och släppa på hela sidan.
   - `#results`: `flex: 1; min-height: 0; display: flex; flex-direction: column`.
   - `.map-wrap`: `flex: 1; height: auto; min-height: 360px`.
3. Lägg till `resize()` i API:t för `ExifMap.create` (anropar `map.resize()`) och
   anropa den efter vybytet och vid `window` `resize`.
4. Tabellvyn: höj `#container`-gränsen till `max-width: 1800px`, så att kolumnerna
   får plats på breda skärmar. Inget annat i tabellvyn ändras.

**Klart när:** vid 1280×800 och 1920×1080 når kartan ut till höger- och nederkanten
(minus 16 px), sidan har ingen rullningslist i kartvyn, och tabellvyn ser ut som förut
(fast bredare) när man byter tillbaka. Popup, kluster och samtyckesrutan fungerar
fortfarande.

---

## Steg 2 — "App i filnamn" ska förklara sig

**Var uppgiften kommer ifrån:** den finns inte i EXIF. `FILENAME_PATTERNS` i
`tools/exif-viewer/exif-core.js` (rad ~51) jämför filnamnet mot kända mönster.
`20240601_142201.jpg` matchar `^\d{8}_\d{6}…\.(jpe?g|mp4|heic)$`, som räknas som
Samsungs kamera-app (`samsung-camera`). Mönstret används även av andra Android-kameror,
så det är en svag indikation. I dag framgår inget av det i gränssnittet.

**Gör så här:**

1. Ge varje post i `FILENAME_PATTERNS` en läsbar mönsterbeskrivning, t.ex.
   `hint: 'ÅÅÅÅMMDD_TTMMSS.jpg'`, och en styrka (`strength: 'stark' | 'svag'`).
   `PXL_…` och `Screenshot_…` är starka, ren datumform är svag.
2. Döp om etiketten (chip, filter och detaljvy) till **"Filnamnsmönster"**.
3. Raden i detaljvyn ska säga: *"Samsung Kamera — filnamnet följer mönstret
   ÅÅÅÅMMDD_TTMMSS (används även av andra Android-kameror). Uppgiften kommer från
   filnamnet, inte från metadata."* Länken till App-ID ska finnas kvar.
4. Jämför med metadata. Om `Make`/`Model` finns och inte stämmer med mönstrets
   tillverkare (t.ex. Apple-metadata men Samsung-filnamn) visas *"Stämmer inte med
   enheten i metadata"*. Det är ett användbart forensiskt tecken på omdöpt eller
   överförd fil. Om det stämmer visas *"Stämmer med Make: samsung"*.
5. Uppdatera `exif-core.test.js` (testet "filnamnsmönster pekar på poster i App-ID") och
   lägg till test för att det stämmer respektive inte stämmer med metadata.

**Klart när:** Samsung-bilderna i testmappen visar mönster, källa (filnamnet) och
"Stämmer med Make: samsung", och en omdöpt iPhone-bild ger varningen.

---

## Steg 3 — Ta bort filer ur listan

**Gör så här** (`tools/exif-viewer/script.js`, `index.html`, `style.css`):

1. Lägg till state `removed = new Set()` med rad-id:n. `visibleRows()` hoppar över
   borttagna. Chipräkning, karta, rutt och alla exporter använder samma lista, så att
   borttagna filer försvinner överallt.
2. En kryssrutekolumn först i tabellen, med "markera alla synliga" i rubriken.
   Klick på kryssrutan får inte öppna detaljvyn (`stopPropagation`; radklick
   hanteras kring rad ~760).
3. När något är markerat visas en rad ovanför tabellen: **"3 markerade · Ta bort ur
   listan · Avmarkera"**. Delete/Backspace i tabellen gör samma sak.
4. En diskret ×-knapp i slutet av varje rad (syns vid hovring och fokus) tar bort
   den raden.
5. Efter borttagning visas en notis: *"3 filer borttagna ur listan (filerna på disken
   påverkas inte) · Ångra"*. Ångra gäller den senaste borttagningen.
6. Filterchippet **"Borttagna n"** visas bara när n > 0. Det listar de borttagna med
   knappen "Återställ" per rad och "Återställ alla".
7. Filer i kön som tas bort läses inte in (hoppa över dem i kön). Rensa tömmer även
   `removed`.
8. Popupen i kartan får en knapp till: "Ta bort ur listan".

**Klart när:** att ta bort tre filer uppdaterar tabell, chip, kartpunkter, rutt och
exporter direkt, Ångra återställer dem, och inget annat beteende ändras.

---

## Steg 4 — Gemensam kartmodul (förberedelse, inga synliga ändringar)

Kartan ska kunna användas av två verktyg (steg 5). Flytta den först, utan att ändra
beteendet.

1. Flytta `map-core.js`, `map-view.js`, `map-core.test.js`, `map-vendor.test.js` och
   `vendor/maps/` från `tools/exif-viewer/` till `tools/_shared/map/`.
2. Uppdatera `scripts/vendor-maps.js` (utdatamappen), sökvägar i testerna
   (`../../electron/map-protocol.js` och `maps/kartdata.json`) och `<script>`-taggarna i
   `tools/exif-viewer/index.html`. Kör `node scripts/vendor-maps.js` och kontrollera att
   `VERSIONS.json` får samma hashar som förut.
3. `map-view.js` hittar i dag sina element via 17 fasta `id`:n (`#map`, `#map-status`,
   `#route-toggle`, `#online-consent` …). Gör om den så att den bygger sin egen panel och
   samtyckesruta inuti en värd: `ExifMap.create({ host: element, … })` → byt namn till
   `ToolboxMap.create`. Markupen flyttas från `index.html` in i JS, och CSS:en för kartan
   från `exif-viewer/style.css` till `tools/_shared/map/map.css`.
4. Vendorfilerna laddas med en sökväg som är relativ till `map-view.js` själv (via
   `document.currentScript.src`), inte till sidan.

**Klart när:** `npm test` går igenom, EXIF-visaren ser ut och fungerar exakt som efter
steg 1–3, och det enda som finns kvar i `tools/exif-viewer/` från kartan är anropet.

---

## Steg 5 — Namn och ett nytt kartverktyg

**Förslag (användaren kan ändra namnen):**

- **EXIF-visare → "EXIF & karta"**, med beskrivningen *"Metadata, positioner och rutt
  för en hel mapp — bara läsning"*. Verktyget behåller tabell och karta som i dag.
- Nytt verktyg **"Positioner"** (`tools/positions/`), beskrivning *"Karta och rutt från
  GPX, KML, CSV, GeoJSON, Google-tidslinje och bilder"*. Här samlas positioner från
  flera källor i samma karta, ett lager per källa.

Uppdatera namnen i `Toolbox.html` (sidopanelen), `README.md` (verktygstabellen),
`docs/DEVELOPMENT.md` och `docs/PLAN.md`.

**Positioner — funktion:**

1. **Import** (släpp filer eller "Lägg till källa"). Tolkningen ligger i
   `tools/_shared/map/import-core.js` (UMD, ren logik, testad):
   - **GPX:** `trkpt`, `rtept`, `wpt`, med `time`, `ele` och `name`.
   - **KML:** `Placemark/Point` med `TimeStamp`, `gx:Track` (`when` + `gx:coord`), och
     `LineString` utan tid.
   - **GeoJSON:** `Point`, `MultiPoint` och `LineString`. Tid hämtas från egenskaperna
     `time`, `timestamp`, `tid` eller `date`. Filer exporterade från EXIF & karta ska gå att
     läsa in igen.
   - **CSV/TSV:** gissa avgränsare (`,` `;` tab) och decimalkomma. Hitta kolumner på namn
     (`lat`/`latitude`/`breddgrad`, `lon`/`lng`/`longitude`/`längdgrad`, `time`/
     `timestamp`/`datetime`/`tid`, `name`/`label`, `accuracy`/`noggrannhet`). Visa en
     förhandsgranskning där användaren kan ändra kolumnvalet innan importen.
   - **Google Takeout:** `Records.json` (`latitudeE7`/`longitudeE7`, `timestamp`) och den
     nya tidslinjen på enheten (`semanticSegments`, `"geo:59.33, 18.06"`).
   - **Inklistrat:** rader som `59.3293, 18.0686` eller `59.3293 18.0686 2024-06-01 14:00`.
   - **Bilder:** "Hämta från EXIF & karta". Det verktyget får knappen "Skicka positioner
     till Positioner". Den skickar via hubben: `postMessage({ source: 'forensics-toolbox',
     type: 'positions', points })` till `parent`. Hubben (`src/script.js`, lyssnaren kring
     rad 284) öppnar Positioner och vidarebefordrar. Skicka bara punktdata (sökväg, tid,
     koordinater, enhet), inga filer.
   - Tider: ISO med zon, epoch i sekunder eller millisekunder (gissa på storleken), och
     tider utan zon markeras "antagen" precis som i rutten i dag.
   - Ogiltiga rader räknas och visas (*"12 rader saknade giltig position"*). De ska inte
     tyst försvinna.
2. **Lager:** en lista i kartpanelen med en rad per källa: namn, färg, antal, synlig
   (kryssruta), rutt på/av och ta bort. Punkter och rutt färgas efter lager.
3. **Manuell punkt:** högerklicka på kartan → "Lägg till punkt här", med etikett och
   valfri tid. Punkten hamnar i lagret "Manuella".
4. Samma tidsfilter och export (KML, GeoJSON, CSV, och nytt: **GPX**) som i
   EXIF & karta. Exporten innehåller källa/lager per punkt.
5. **Prestanda:** 100 000 punkter ska gå att läsa in. Tolka i bitar med
   `setTimeout`-pauser och visa förloppet, använd kluster, och förenkla ruttlinjen när
   den har fler än 5 000 punkter (Douglas–Peucker i `map-core`).

Testdata i `tools/_shared/map/fixtures/`: små exempelfiler för varje format, med
kantfall (tom fil, saknad tid, decimalkomma, latitud/longitud omkastade, 0,0).

**Klart när:** alla format i fixtures läses in med rätt antal punkter och tider, lager
kan döljas och tas bort, och en GeoJSON-export från EXIF & karta ger samma punkter
när den läses in i Positioner.

---

## Steg 6 — Mer avancerad rutt (i `map-core.js`, används av båda verktygen)

Rutten i tidsordning finns redan och var uppskattad. Bygg vidare i den här ordningen:

1. **Sträcka, tid och fart per steg.** Avstånd med haversine, tidsskillnad och fart.
   Visas i popupen: *"Från föregående: 420 m på 4 min 28 s (5,6 km/h)"*, och totalt i
   panelen: *"Rutt: 10 punkter, 3,9 km, 1 h 2 min"*.
2. **Orimlig förflyttning.** Ett steg med fart över ett tröskelvärde (standard
   250 km/h, går att ändra) ritas som röd streckad linje och listas: *"2 förflyttningar är
   orimligt snabba — kontrollera tid eller position"*. Steg kortare än 200 m räknas inte,
   eftersom GPS kan hoppa så mycket. Det här är forensiskt värdefullt: det fångar fel
   tidszon, fel klocka och omdöpta eller manipulerade filer.
3. **Dela upp vid uppehåll.** Ett uppehåll över N timmar (standard 3 h) bryter rutten i
   separata turer. Varje tur har egen färgton och visas i en förklaringsruta: *"Tur 1 · 1
   juni 14:00–15:02 · 3,9 km"*. I testmappen ska det bli tre turer: promenaden,
   Djurgården och Södermalm.
4. **En rutt per enhet eller källa.** Ett val "Dela rutt per enhet" (i EXIF & karta per
   `device`, i Positioner per lager) ger en linje per enhet i olika färger. Samsung och
   iPhone i testmappen ska ge två rutter.
5. **Vistelser.** Följande punkter inom 100 m som tillsammans täcker minst 5 minuter
   slås ihop till en vistelsemarkör: *"Vistelse 14:22–14:31 · 4 filer"*.
6. **Steglista.** En hopfällbar lista bredvid kartan med punkterna i ordning: tid,
   namn, avstånd från föregående och varningar. Klick fokuserar punkten, och vald punkt
   markeras i listan.
7. **Tidsreglage och uppspelning.** Ett reglage under kartan från första till sista
   tiden. När man drar det visas rutten fram till tiden T, med en markör på aktuell plats.
   En spelknapp med hastighetsval (1 min/s, 10 min/s, 1 h/s). Fältet "Position vid tid T"
   visar närmaste punkt före och efter T med tidsskillnad, och en uppskattad position
   mellan dem som tydligt märks *"interpolerad, inte uppmätt"*.
8. **Export.** KML får `TimeSpan` per steg, så att Google Earths tidsreglage fungerar, och
   en mapp per tur. GPX-exporten får ett `trkseg` per tur.

Tester i `map-core.test.js`: kända avstånd (t.ex. Centralstationen–Slussen ≈ 1,3 km),
fartgräns och 200 m-golvet, uppdelning vid uppehåll, vistelser, en rutt per enhet, blandade
tidszoner (QuickTime i UTC mot EXIF med +02:00) och interpolering vid tid T.

**Klart när:** testmappen ger tre turer, en vistelse på Stortorget, två rutter vid
"Dela rutt per enhet", inga orimliga förflyttningar. En kopia av en bild med tiden
flyttad en timme ger en röd varning.

---

## Efter varje steg

1. `npm test` går igenom.
2. Kontrollera i appen (`npm start`) med testmappen: tabell, filter, detaljvy,
   karta, popup, kluster, rutt, onlinekarta (samtycke visas först), tema ljust/mörkt
   och export.
3. Offline: inga http(s)-anrop med onlinekartan avslagen (DevTools → Network).
4. Uppdatera `README.md`, `docs/DEVELOPMENT.md` och `docs/PLAN.md` när något syns för
   användaren.
5. Commit på grenen. Versionen (`Version 1.8` i `Toolbox.html`, sedan
   `node scripts/sync-version.js` och `npm install --package-lock-only --ignore-scripts`)
   höjs först när användaren vill släppa.
