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

Under utveckling körs appen i Electron. Html-versionen, som är `Toolbox.html` öppnad direkt i webbläsaren under `file://`, provas med `npm run test:html` (se Tester).

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
| `npm test` | Enhetstesterna under `tools/` (Node) |
| `npm run test:app` | Provkörning av hela appen i Electron: röktestet, och facit om labbzippen finns (se Tester) |
| `npm run test:html` | Html-versionen i Edge eller Chrome under `file://`, utan internet: röktestet, utan JIT och beskeden utan WebAssembly |

## Windows-build (målplattform)

Cross-build från en enda maskin är opålitligt. Använd:

1. **GitHub Actions** – `.github/workflows/build-release.yml` bygger **Windows + Linux + macOS** parallellt (matrix) vid push till `main` (ignorerar rena `.md`-ändringar), eller  
2. Lokalt: `npm run dist` (Windows), `npm run dist:linux`, `npm run dist:mac`

Artifacts (efter finalize / CI):

- `ForensicsToolbox-X.Y-Portable.zip` (packa upp och kör `Forensics Toolbox.exe`)
- `ForensicsToolbox-X.Y-Installer.exe`

Portabel Windows är en zip i stället för en självuppackande `.exe`: med kartorna är appen
runt 1,5 GB, och en portabel `.exe` packar upp allt till en tempmapp vid varje start.

**macOS** signeras ad hoc (`mac.identity: "-"`, `hardenedRuntime: false`), utan certifikat från Apple. Med `identity: null` behölls
Electrons signatur, som blir ogiltig när appens filer läggs till: `codesign --verify` misslyckas, och macOS säger att en nedladdad app är skadad.
Kontrollera ett bygge med `codesign --verify --deep --strict`, också efter att zippen packats upp med `ditto -x -k` och i den monterade DMG-filen.
Hur Gatekeeper svarar går bara att se på en Mac där `spctl --status` säger `assessments enabled`, med en fil hämtad i en webbläsare.

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
(`tools/db-queries/fixtures/photos-schema.json`). Härkomst väljer bandet efter iOS-versionen i
`SystemVersion.plist`. Saknas den väljs bandet efter databasens schema
(`ProvenanceRoles.photosBandFromSchema`: `ZGENERICASSET` → iOS 10–13, `ZASSET` med
`ZIMPORTEDBYBUNDLEIDENTIFIER` → iOS 17+, utan → iOS 14), och protokollet får en varning.
Ny iOS-version i iLEAPP:

```bash
git clone --depth 1 https://github.com/abrignoni/iLEAPP /tmp/iLEAPP
# lägg till REF-filen i scripts/photos-schema-from-ileapp.js
node scripts/photos-schema-from-ileapp.js /tmp/iLEAPP/scripts/artifacts
npm test
```

### Extraktionen följer med mellan verktygen (`src/script.js`)

- Huvudfönstret minns zippen (File-objektet) som senast öppnades eller stängdes i Härkomst eller
  Queries, med ett löpnummer: `{ file, seq, from }`. Verktyget som öppnade eller stängde skickar
  `{ type: 'extraction-changed', file }` (`null` vid stängning); huvudfönstret visar zippens namn i
  sidopanelen (`#extraction-status`) och skickar `{ type: 'extraction', file, seq, from }` till ett
  verktyg när det laddas eller visas.
- Verktyget följer bara ett löpnummer det inte redan sett, så att testdata i Härkomst inte byts bort
  bara för att verktyget visas igen. Härkomst följer direkt när inget visas; visas en bedömning eller
  en lista erbjuds bytet på en rad (`#ex-follow`). I Queries behåller en flik med en databas ur sin zip
  zippen, och bytet erbjuds i flikens notis; startsidan och nya flikar följer. Öppningarna i Queries
  görs i tur och ordning (`serial()` i `extraction.js`), så att läget och en query från Härkomst inte
  läser samma zip två gånger.
- Raden högst upp (`#context-bar` i `Toolbox.html`) visas i Härkomst, Queries och EXIF & karta
  (`CONTEXT_TOOLS`). Där öppnas, byts och stängs extraktionen; ändringen skickas med `force` till verktyget
  som visas, som då byter även om det visar något. Inne i huvudfönstret döljer verktygen sina egna knappar
  för att öppna och stänga (`body.in-hub .standalone-only`). Verktygen rapporterar
  `{ type: 'extraction-info', file, info: { device } }` (iOS 26.0, Android 13) och
  `{ type: 'current-file', name, path, place }` (filen som visas, `name: null` när den inte visas längre).
  Versionen läses medan zippen öppnas och kommer därför före `extraction-changed`; huvudfönstret sparar
  den (`pendingInfo`) tills beskedet om samma fil kommer.
- Mellan verktygen: raden ber verktyget som har filen om den (`{ type: 'deliver-file', to }`), verktyget
  svarar `{ type: 'file-for', to, files: [{ file, path }] }`, och huvudfönstret öppnar målet och skickar
  `exif-files` (EXIF & karta läser filerna som från disk och öppnar en ensam fil) eller `provenance-files`
  (Härkomst letar upp samma innehåll i extraktionen). Härkomst läser filen ur zippen först när den behövs
  (`entriesAsFiles()`, högst 1 GB åt gången). Queries skickar filnamnen i ett resultat med `ZFILENAME`,
  `_display_name` eller `filename` som `{ type: 'names-for', to: 'provenance', names, zipName }`.

### Queries: arbetsbänken, flikar och SQL från Härkomst (`tools/db-queries/`)

- Arbetsbänken (1.38): sidopanelen (`.side`, klistrad i fönstret) har **Översikt** överst, en sökruta och
  databaserna per OS och kategori (`CATEGORIES` i `script.js`: Operativsystemet, Snapchat, Signal; en databas
  utan `category` hör till operativsystemet). En databas per familj (`familyKey()`) med sina queries
  (★ = rekommenderad, "Hjälp:"/"Tips:" grå). Photos.sqlite har knappar per iOS-version (`pickVersion()`:
  filen eller posten i zippen och queryn står kvar, `extraction.repick(dbId)`). Med en extraktion eller en
  fil öppen står deras databaser först och resten under en ihopfälld **Inte i extraktionen** (bara en fil:
  **Andra databaser**). Sökningen matchar familjens namn eller queryns titel, beskrivning och `returns`, och
  fäller ut alla träffar. `renderSide()` ritar om panelen vid varje byte.
- Fälla ut och ihop (1.39): ett klick på en databas fäller ut eller ihop dess queries (`toggleFamily()`),
  också den valda, och ändrar inte arbetsytan; en query öppnas med ett klick på den (`pickQuery()`). Den
  valda databasen fälls ut när den väljs (`shownKey`, `curCollapsed`) och visas i accentfärg när den är
  ihopfälld. Databaser som undersökaren fällt ut (`userOpen`) står kvar; den som bara fälldes ut för att den
  valdes fälls ihop när en annan väljs. Under en sökning gäller `searchClosed`, som töms när sökningen
  ändras. **Inte i extraktionen** fälls ut en gång när den valda databasen ligger där, och läget sparas från
  klicket på rubriken (`missingOpen`).
- Knappen högst upp (1.39): en knapp för både extraktion och databas. I Forensics Toolbox är det
  huvudfönstrets `#cb-open`, som i Queries heter **Öppna extraktion eller databas…** (`#cb-input` med
  `multiple`, utan `accept`) och skickar filerna till Queries (`open-files`); i de andra verktygen tar den
  bara en zip. Fristående har Queries en egen rad (`.q-bar`, `#open-pick`). `QueriesExtraction.openPicked()`
  läser de första 16 byten och avgör med `identify.js` (`kindOf()`, `sortPicked()`): en zip öppnas som
  extraktion och meddelas huvudfönstret (`extraction-changed` med `bar: true`, så att den räknas som öppnad
  i raden); en ensam `-wal` läggs till filen från disk; `-shm` hoppas över. En SQLite-fil läses in med
  `QueriesRun.load()` (`-wal` pålagd, SHA-256) och `DbIdentify.rank()` provar varje katalogdatabas queries
  med `prepare()` mot filens schema. Queries som går att förbereda mot en tom databas (schemafrågor) räknas
  inte. Bäst är den där alla queries passar, sedan den som visas, filens namn, extraktionens (eller den
  visades) operativsystem, störst andel och flest av filens kolumner (`specificity()`: Snapchats arroyo.db på
  Android har kolumner som iOS saknar). `conclude()` ger familjerna filen gäller: alla där alla queries
  passar eller minst hälften. Utan träff känns filen igen på namnet (`fromName()`), en krypterad fil bara
  bland databaserna med `cipher`. Photos.sqlite för varje iOS-version känns igen på schemat
  (`identify.test.js` med `fixtures/photos-schema.json`).
- Källan i fliken: `source` i `script.js` är `{ zip }` eller `{ file }`, och `extraction.js` har `current`
  (zippen) och `loose` (filen från disk, med den inlästa databasen så att första körningen inte läser om).
  Filen gäller familjerna den känns igen som, eller alla som inte finns i zippen när den inte känns igen
  (`looseCovers()`); i sina familjer går den före zippen. **Stäng filen** i källraden eller översikten går
  tillbaka till zippens databas (`reattach()`). Öppnas en zip medan en query visas utan fil används zippens
  databas direkt, med samma query (`selectDb(id, { keepQuery })`). Spårbarheten börjar med
  `Från disk: <namn> (<byte>, ändrad <tid>)` för filer från disk.
- Översikten (`#start`): ingen databas vald. Zippens databaser i en tabell med sökväg, storlek, tid och `-wal`
  (`extraction.js`, `render()`), och filen från disk på en rad under med vad den känns igen som.
- Arbetsytan (`#workspace`), uppifrån: queryrutan (`.q-card`: var databasen hör hemma, namn, märke,
  beskrivning, fälten och **Kör query** på en rad med CSV, karta och Härkomst till höger, tidsspannet i klartext
  och sist raden **Källa** med filerna, platsen i zippen när databasen finns på flera ställen, noter och
  nyckelraden för SQLCipher), resultatet (`.r-card`: statusraden och tabellen, eller påhittade exempelrader
  innan queryn körts), och flikarna **SQL**, **Spårbarhet** (källan, CRC32 och SHA-256 för senaste körningen)
  och **Om databasen** (beskrivning, sökväg, källa, noter och posten i zippen). Ett klick på den öppna fliken
  fäller ihop rutan. CRC32 som inte stämmer öppnar Spårbarhet (`queries:show-pane`).
- Innan queryn körts står märkta, påhittade rader i `#result-preview` (`renderResultPreview()`): märket **Exempel**,
  "Queryn är inte körd", tre rader i kursiv och randig ruta, och en knapp **Kör query** när den går att köra (klassen
  `can-run`, satt i `updateState()`). Ett riktigt resultat får märket **Resultat** i statusraden. Knapparna för CSV och
  karta säger i sin text varför de är avstängda, och statusraden får länken **Visa på karta** när resultatet har
  latitud och longitud.
- Fälten sparas per namn i `paramMemory`: samma tidsspann eller filnamn står kvar när man byter query eller
  databas i fliken, och Enter i ett fält kör queryn. En annan query i samma databas (`selectQuery()`,
  händelsen `queries:query-change`) tömmer resultatet men behåller filerna och den inlästa databasen.
  Smalare än 980 px står sidopanelen överst.
- Fart (1.48): en inläst databas hålls kvar i `kept` (högst 2 GB utöver den som används, de äldsta släpps först, nyckeln
  är `zipSource().key` och nyckelfrasen), så att en annan databas, en ny flik eller ett klick från Härkomst inte läser,
  hashar och dekrypterar om. Filer från disk har sin egen `loose.opened`. Tar minnet slut (`err.code === 'MEMORY'`) släpps
  det som hålls kvar och läsningen görs om en gång. SQL som bara läser körs mot en öppen databas utan kopia: 1,6 GB tar
  0–6 ms per körning mot 140–150 ms med kopia. Tabellen ritas 200 rader i taget när rutan närmar sig slutet
  (`renderTable()`, `drawMore()`), och flikbytet flyttar raderna i stället för att skriva om dem som text: byte till en
  flik med 2 000 rader × 21 kolumner tar ca 27 ms mot ca 225 ms.
- `tabs.js`: varje flik är ett sparat läge. Vid byte sparas `QueriesApp.snapshot()`,
  `QueriesRun.snapshot()` (filer, inläst databas, resultatets rader, var rutan stod) och `QueriesExtraction.snapshot()`, och
  den andra flikens läge läggs tillbaka med `restore()`. Extraktionen och filen från disk hör till fliken
  (`QueriesExtraction.snapshot()` ger `{ ex, chosen, loose }`), och en ny flik får programmets extraktion
  (`adoptShared()`), fristående den zip som är öppen, men ingen fil (`fresh()`).
- `openFromProvenance()`: samma zip, sökväg och SQL visar den flik som redan finns, annars används
  en tom flik eller öppnas en ny. `QueriesApp.showCustom()` visar SQL:en utan fält,
  `QueriesRun.run()` kör den, och `QueryRunCore.withUtcColumns()` lägger en kolumn `<namn> (UTC)`
  efter varje tidskolumn (samma epoker som `roles.js`). Händelsen som klickades på följer med som `mark`
  (`{ ms, startMs, values, text, time }`). `QueryRunCore.findRows()` letar upp raderna med den tiden i en tidskolumn, och
  bland rader med samma tid de som har händelsens värden (meddelandets id, appen). Raderna får klassen `row-hit`, ett
  radnummer står först, `#run-hit` säger vilken rad det är, och rutan ställer sig vid raden (`showHit()`). Är resultatet
  större än det som visas väljs raderna runt den markerade (`rowWindow()`). Har slutet på ett intervall ingen egen rad
  (appen på skärmen slutar när skärmen släcks, ur en annan tabell) markeras raden där det började, och det sägs.
  Kontrollerat 2026-11-04 på `IMG_0042.HEIC` i labbextraktionen: alla 309 länkar öppnade rätt databas, 301 gav en rad, 4
  gav två positioner med samma tid och 4 slut gav raden där det började.

### Härkomst (`tools/provenance/`)

Tidslinje och bedömning för en bildfil. Verktyget har ingen egen SQL: det hämtar dolda
rollqueryer ur katalogerna (`hidden: true`, `role`, `epoch`, `fields`), kör dem mot databaserna
i extraktionen med `-wal` pålagd, och bygger en händelselista i UTC.

- `roles.js` samlar rollerna per källa och Photos-band och fyller i platshållarna med tal.
- `timeline-core.js` avgör typ av fil (kamerabild, skärmdump, sparad ur app), bedömer
  skapandetid, app igång, kamera igång och skärm som förenligt, inte förenligt eller saknas (`STATE_LABEL`),
  ger varje faktor dess fråga och svar i klartext (`FACTOR_WORDS`, `describeFactor()`: `question`, `verdict`,
  `meaning` mot `hypothesis()`), och har
  förklaringens ordförråd. Allt testas i Node.
- Filens tider (`fileTimes()` i `timeline-core.js`, `timesHtml()` i `script.js`, `timesTableHtml()` i `report.js`): faktorn
  Skapandetid har `times`, en rad per källa i tidsordning: tiden i filen, bibliotekets tider, andra register och filsystemets
  tider, med källa (databas → tabell → kolumn, Filen → tagg eller Zippen → fält → vilken tid), skillnaden mot T och en rad för
  det som saknas (`absent`). Tabellen är bara fakta. Tolkningen står i `items` under den. Filkortet har samma rader
  (`ProvenanceMedia.timesGroup`) i samma format och zon, utan källa och skillnad mot T, så att det syns direkt att filen har tider
  och inte kan läsas som att de saknas. Tider inuti filen kommer ur `ExifCore.timeTags()`: den viktigaste visas alltid, de andra
  när de skiljer sig mer än 2 s. Alla står i Exif-vyn.
- Vad Skapandetid säger (`factorTime()`):
  - **Hypotesen avgör vad en skillnad betyder.** Tillagd långt efter Skapad säger bara emot `camera` och `screenshot`. En fil
    som tas emot, en dubblett och en sparad fil får bära en äldre tid (`support`, egna ord i `verdictText`). En annan tid i
    filen än i biblioteket säger bara emot `camera` och `screenshot`, och inte heller dem om bibliotekets kopia står kvar på
    filens tid. Annars är det `info` med "Tiderna går isär" och `timesSplit`, som ger egen `meaning`.
  - **Samma källa räknas inte två gånger.** `ZDATECREATEDSOURCE` (`createdSource`, iOS 15 och senare) säger var `ZDATECREATED`
    kommer ifrån: 1 när filen har en egen tid, 3 när den inte har det, och då är Skapad filsystemets skapandetid. Apple
    dokumenterar inte värdena. iLEAPP har samma tolkning, och den stämmer på alla 34 filer i labbextraktionerna: med 1 ligger
    filens tid inom 0,15 s, med 3 filsystemets inom 0,93 s, utom på bilden vars datum ändrades. Jämförelser mot källan blir
    `info`, och en skillnad över 2 s betyder att något har ändrats (QuickTime har en minuts marginal, eftersom en vanlig video
    från kameran inte finns i labben). Bibliotekets kameramodell är också läst ur filen, så bara en skillnad nämns.
  - **T jämförs inte med sig själv.** Utan rad i biblioteket är T tiden i filen eller filsystemets ändringstid
    (`fileSource.db` är `bildfilen` eller `zippen`), och raden heter det i stället för Skapad. Finns inget annat att jämföra med
    är svaret "Kan inte jämföras". En fil av okänd typ prövas mot att den kom till på telefonen, inte mot kameran.
  - **Rapportens zon ändrar inget.** En tid utan zon i filen tolkas i bildens zon (`exifZone()` i `media-card.js`:
    `ZTIMEZONEOFFSET`, annars `ZTIMEZONENAME`). Rapportens zon används bara när bilden saknar zon, och en skillnad jämnt på
    kvarten är då `info` (`zoneLike()`).
  - **`ZEXIFTIMESTAMPSTRING`** är klockslaget i bildens zon. Den stod kvar när datumet ändrades i Bilder och skilde sig bara på
    den bilden av 55 rader. Det är sett på en bild, så texten säger "ser ut att". Raden visas bara när den skiljer sig. Namnet
    till trots finns värdet också på filer utan EXIF.
- `timeline-svg.js` ritar tidslinjen med en rad per jämförelse (Fil, App, Kamera, Skärm, Lås,
  Position, Snapchat): översikten över hela fönstret med närbildens ruta (`opts.zoom`) och
  närbilden runt T med händelserna utskrivna (`opts.labels`). `block()` ritar varje rad två gånger:
  först för att räkna textspåren (högst `MAX_LANES`), sedan på sin plats, så att en rad med många
  texter blir högre i stället för att tappa text. Snapchat-markörer som skulle hamna på varandra
  flyttas högst `DODGE_MAX` px åt höger i tidsordning. Korta texter i `snapLabel()`/`fileLabel()`,
  teckenförklaringen i `legendItems()` (bara det som finns i fönstret, radbruten).
  `opts.detail` är `'focus'` som standard: `focusSet()` väljer det som gäller den bedömda filen och
  läget vid T, och resten ritas med `opacity` `FADE` utan text. `'all'` skriver ut allt. Härkomst
  ritar om tidslinjerna med `renderTimelines()` när reglaget byts; exporterna får bilderna som visas. Varje fönster bär sin
  närbild (`w.closeup`, en tiondel av fönstret åt varje håll, minst 30 s), och förklaringens
  rader vet sin källa och om de ligger inom närbilden (`near`), vilket styr nyckelhändelserna.
  **Filens tidpunkter.** En fil kan ha flera tider långt från varandra: en gammal bild som nyss kom till telefonen har T
  år före den tid då undersökaren vill se vad telefonen gjorde. `windows()` ger T, `added` och `file.extraWindows`, och tar
  bort varje tidpunkt inom fönstret från en tidigare. `describeWindows()` sätter `isT`, källan, och namnet på T efter var
  tiden kommer ifrån. Filer utanför biblioteket saknar `addedMs`, så `assess()` lägger `fsMoment()` i `extraWindows` när
  filen lästs: skapandetiden i filsystemet, annars ändringstiden. Bibliotekets filer får den inte, för där är `added` den
  andra tidpunkten. `model.moments` ger knapparna ovanför tidslinjen, och de syns bara med minst två tidpunkter. En
  tidslinje i taget visas, de andra är dolda i sidan så att bilderna finns kvar. Startvalet (`defaultMoment`) är T, om inte
  telefonen saknar allt vid T och har något vid en annan tidpunkt. Samma fil behåller valet när tidslinjerna ritas om
  (`state.moment`). `phoneLines` är raderna i händelsetabellen och `phoneEvents` allt i fönstret; bara positioner ger
  "registreringar". Faktorerna gäller T, så `nearT()` håller händelser vid andra tidpunkter utanför "i fönstret". Utanför T
  (`ctx.atT === false` i `timeline-svg.js`) heter markeringen tidpunktens namn och kolumnen Läget, utan faktorns ord, och
  kolumnen visar bara det som syns i tidslinjen. Närbilden får översiktens fönster i `opts.stateWindow`, så att de säger samma sak.
  Protokollet och förklaringen har alla tidpunkter, oavsett vilken knapp som är vald.
  `report.js` bygger protokollet och förklaringen som HTML med inline-stilar för Word; båda
  får översikt, närbild och undersökarens egen bedömning (`meta.ownAssessment`).
  `keyEventsTable()` och `eventsTable()` ger nyckelhändelserna och händelserna med källa som egna
  tabeller för Word (knapparna Kopiera tabellen för Word); protokollets händelsetabell är samma.
- Från Härkomst till Queries: `runRole()` sparar zip-sökvägen, tidskolumnerna och tiderna i svaret med varje query
  (`meta.queries[].path`, `walPath`, `timeColumns`, `times`). En klick på en källa skickar
  `{ type: 'open-query', file, path, sql, queryId, timeColumns, mark }` till huvudfönstret
  (`src/script.js`), som öppnar Queries och skickar vidare. `runnableQuery(src, ms)` väljer körningen: samma rollquery körs
  mot flera databaser (`role-messages` mot Signal, WhatsApp, Telegram och Snapchat), så källans databas och händelsens tid
  avgör. Har ett PowerLog-arkiv tiden blir källan text, eftersom ett komprimerat arkiv inte går att öppna i Queries. Filen (File-objektet för zippen) går
  med i `postMessage`; Queries öppnar den bara om den inte redan är öppen (namn, storlek, ändringstid).
- Zippens tider (`zip.js`): filsystemets tider, som extraktionsverktyget sparade i zippen. UT-fältet 0x5455
  (Unix-sekunder; ändring, och fler tider när flaggorna säger det) och NTFS-fältet 0x000A (FILETIME; ändring,
  åtkomst och skapande, som i Arkiv-zippen), som går före UT. Info-ZIP skriver bara ändringen i
  innehållsförteckningen; resten läses ur den lokala posten när posten läses (`extract`).
  Posten får `mtime`, `atime`, `crtime` (skapad), `ctime`, `utThird` (Unix-sekunder) och `timeField`;
  `ExtractionCore.entryTimes()` ger dem som text. Utan något av fälten finns bara DOS-tiden (lokal tid, zon okänd).
- Zippar med metadata (`tools/db-queries/fs-times.js`): har zippen `metadataN/metadata.msgpack` bredvid `filesystemN/` kommer tiderna därifrån, med riktiga namn och
  på millisekunden, avrundade från nanosekunder (`timeField` `metadata.msgpack`). Zippens egna fält säger inget i de zipparna: UT-fältet har flaggorna 7 och tre lika värden, alla lika med `atime`, och
  DOS-tiden är samma tid i lokal tid. Prövat på två iPhone-extraktioner, 329 181 och 315 296 filer: alla finns i kartan, och alla fyra tider stämmer med en
  oberoende läsning i Python. `ctime >= mtime >= btime` gäller på 99,99–100 %, och `-wal` med innehåll har `mtime` senare än `atime` på omkring 90 %. En post under
  `filesystemN/` utan rad i kartan får inga tider. Går filen inte att läsa säger Härkomst det. En zip med samma fält men utan metadata går inte att känna igen, och då gäller nästa punkt.
- UT-fältets tider efter flaggorna: `0x7` är ändring, åtkomst och en tredje tid. Info-ZIP kallar den
  skapandetid, men andra verktyg lägger ctime där och zippen säger inte vilket, så den blir `utThird` och visas
  som "Tredje tiden i zippen" utan slutsats. `0xf` (FFS-zippen från iOS-labbtelefonen) har en fjärde tid, utanför
  Info-ZIP:s beskrivning: den tredje är `ctime` och den fjärde `crtime`. Tolkningen är härledd ur datan, inte
  dokumenterad av verktyget: av 628 903 poster är den tredje tiden tidigare än ändringen i 101 och senare i
  116 560, den fjärde tidigare i 42 056 och senare i 8. I bildbiblioteket följer den tredje tiden `ZADDEDDATE`
  (`IMG_0013.HEIC`: Tillagd 09:18:16, tredje 09:18:17, fjärde 15:33:09 dygnet innan, samma som Skapad).
  Physical Analyzer läser tiderna likadant: i rapporterna från samma zip är `ModifyTime` den första, `AccessTime` den andra och `CreationTime` den fjärde på alla 311 807 filer, och den tredje finns inte med.
  Prövat 2026-11-05 på samma telefon före och efter labbsessionen, 628 390 gemensamma poster: den tredje tiden flyttades
  ensam på 843 filer med samma innehåll. Den fjärde flyttades bara tillsammans med ändringstiden och den tredje (1 952 filer,
  nya filer på samma sökväg). Ingen av dem gick bakåt. Alla sex loggade metadataändringar (favorit, nytt datum, dubblett,
  beskärning, plats, Raderade) hamnade i den tredje tiden, fem inom 3 s och favoriten 25 s före loggraden.
- På APFS följer skapandetiden med bakåt när ändringstiden sätts bakåt, medan ctime står kvar (provat på en Mac:
  `touch -m -t` med ett gammalt datum). Därför är filsystemets skapandetid inget skydd: en fil som tas emot kan se ut att ha
  skapats långt innan den fanns på telefonen, som AirDrop i labbet. Bara 8–9 av 630 000 poster har en skapandetid efter
  ändringstiden. Det är bland annat bildväljarens kopior.
- Extraktionen läses med `tools/db-queries/extraction-core.js`, som Queries också använder. Bara
  läsning: testet i `zip.test.js` grep:ar alla filer i `tools/provenance/` efter skrivande API:er.
  Härkomst läser zippens innehållsförteckning en gång per öppnad zip (`ZipRead.cacheDirectory`)
  och söker sedan i minnet; posterna själva läses alltid ur zippen.
- Under en bedömning är knapparna som byter zip, fil eller testdata spärrade (`busy()`, `BUSY_IDS`), så
  att två extraktioner aldrig blandas i ett protokoll. Byte av zon eller fönster kör om den senaste
  bedömningen (`state.redo`), och undersökarens text och bockar hör till filen (`assessmentKey()`: zip
  och rad eller sökväg).
- En lista från disk (`pickFromDisk()` i `script.js`): knappen **Välj en lista eller bilder…** läser en textfil
  (`isListFile()`: `.txt`, `.csv`, `.tsv`, `.md5`, `.sha256` och liknande, högst 64 MB) med `parseList()`: ett namn eller en
  summa per rad, utdata från md5sum, shasum och BSD md5, hashdeep, eller en tabell. Med rubrikrad används kolumnen med
  summan, annars den med filnamnet; utan rubrik är en rad en fil, utom när den bara har namn eller bara summor. Rader med
  `#` är kommentarer, så en CSV-fil ur Queries går att läsa. Texten avkodas som UTF-8 eller UTF-16 med BOM, annars
  Windows-1252 (`decodeList()`). Namnen hamnar i rutan och går samma väg som om de klistrats in. Andra filer letas upp på
  innehållet som förut; Excel, Word och PDF får ett besked om att spara som text.
- Flera filer (`batch.js`, UMD `ProvenanceBatch`): `parseNames()` tolkar inklistrade namn (per rad,
  semikolon, eller komma när varje del har en ändelse), och `runBatch()` i `script.js` bedömer varje
  post med samma `assess()`/`assessEntry()` som en ensam fil men med `quiet`: inget filkort, ingen
  tidslinje eller karta, och `finalize()` returnerar `{ model, meta }`. `summarize()` gör listans rad,
  och `ProvenanceReport.batchTable()` tabellen för Word. Ett klick på en rad gör om bedömningen för
  filen i den vanliga vyn. Ett val bland flera träffar sparas på raden (`item.pk` eller `item.path`),
  så att det gäller när listan görs om. Undersökarens text och bockar sparas per fil i
  `state.examiner` (nyckeln innehåller zippen) och finns kvar så länge programmet är öppet.
  Raden med Tillbaka till listan, Föregående och Nästa fil (`#batch-nav`) ligger i filrutan ovanför
  vallistan, inte i `#result`, så att den syns också när en rad med flera träffar visar sin vallista.
- Sök på hashsumma (`hash-search.js`, UMD `ProvenanceHashSearch`): `parseNames()` släpper igenom
  MD5, SHA-1 och SHA-256 (32, 40 och 64 hexadecimala tecken, med komma, mellanslag eller en per rad,
  och summan ur en rad från md5sum). `runWithHashes()` i `script.js` tar först bort summor som är ett
  filnamn i zippen (Snapchats cachenycklar ser ut som MD5) och söker resten i en enda läsning:
  `plan()` lägger bild- och videofilerna först, sedan filerna utan ändelse och sist resten, i zippens
  ordning; `search()` läser varje post med `ZipRead.stream()` (i bitar om 4 MB, utan att posten hamnar
  i minnet, och en liten post i samma läsning som sin lokala post), räknar bara de summor som söks och
  stannar när alla är hittade. Kopiorna (samma storlek och CRC32) kontrolleras med samma summa. Hittas
  en summa inte har alla poster lästs, och `missingText()` säger det. Summorna sparas per zip i
  `state.zip.hashCache` (nyckel `localOffset:namn`), så att en ny sökning inte läser om något.
  En träff bedöms som en fil från disk (`resolveFound()`: biblioteket när en kopia ligger i DCIM, annars
  posten), och `foundBy` följer med till filkortet och protokollet, jämförd med filens egen summa.
  Arkiv-zippen (70 854 poster, 8,9 GB): bild- och videofilerna på några sekunder, hela zippen på 72 s.
- Positionerna (`role-location`) läses utan `LIMIT`: förut tog queryn de 500 första i tidsordning, och vid
  ±24 timmar försvann positionerna kring T. Queryerna läser spannet från det första fönstrets början till
  det sista fönstrets slut; positionerna och grannbilderna sorteras sedan till fönstren
  (`ProvenanceCore.inWindows()`), så att en bild som kom till telefonen långt efter att den skapades inte
  får med allt däremellan. Positionsfaktorn jämför bara positionerna i fönstret runt T och nämner de andra.
  Samma `LIMIT` togs bort i grannbilderna (300) och Snapchats fönsterqueryer (500 och 2000).
- Kartans sammanfattning: `MapCore.summarizeTrack()` (`tools/_shared/map/map-core.js`) gör vistelser av
  positioner i följd inom 100 m från den första, under minst 5 minuter (samma gräns som rutten i
  Positioner), och glesar ut förflyttningen till en position var 250:e meter eller var 5:e minut.
  `positionView()` i `script.js` sammanfattar per fönster och behåller telefonens positioner närmast före
  och efter T. Kartan ritar en vistelse som en `visit`-punkt med ring, ankomst och avfärd, utan klungor
  (`mapView.setClustering(false)`); tabellen och protokollets avsnitt 4 följer läget, och alla positioner
  står kvar under Händelser.
- Appbehållare på iOS (`knownContainers()`): GUID:t blir appens id ur behållarens
  `.com.apple.mobile_container_manager.metadata.plist` (`MCMMetadataIdentifier`, läst med
  `tools/ios-keychain/lib/bplist.js`) och namnet ur App-ID. `ProvenanceCopies.classifyPath()` tar
  `opts.containerApps` och `opts.appName` (paketnamn på Android).
- En fil utanför biblioteket utan EXIF-tid får T ur zippens ändringstid, även när zippen bara har
  DOS-tid utan zon (`ProvenanceMedia.entryMs`, som sökningen på tid); protokollet får en varning.
- Bildfilen läses ur zippen och ExifTool-workern från EXIF & karta laddas först när den behövs.
- Positionerna (bildens enligt databasen och EXIF, telefonens enligt routined) visas i en tabell
  och på den delade kartvyn med nålar. Kartbilden hämtas med `mapView.toImage()` och läggs i
  båda exporterna. Kartans laddning kräver att fönstret ritas: med låst skärm kommer ingen
  bildruta, och då går exporten vidare utan kartbild efter tio sekunder.
- På iOS kommer app och kamera ur knowledgeC `/app/usage` (`/app/inFocus` saknas på iOS 18
  och 26, de versioner som kontrollerats, och är bara reserv). Skärmen, låset och kameran per app kommer
  också ur PowerLog (se nedan). På Android ur `usagestats` (app, skärm, lås) och `appops`
  (kameran per app), lästa som filer ur zippen av `android-logs.js`; Wellbeing är reserv.
- `android-logs.js` (UMD `ProvenanceAndroidLogs`): `abxParse` för Androids binära XML (ABX,
  magic `ABX\0`, internerade strängar, samma utskrift som `abx2xml`), `discreteOps`/`opIntervals`
  för `appops/discrete/<ms>tl` (op 26 = kamera; startraden och slutraden med `nd` har samma `nt`,
  slutraden kan ligga i en senare fil), och `usageMappings`/`usageDaily` för
  `usagestats/daily/<beginMs>` (version 5 `IntervalStatsObfuscatedProto` med `mappings`:
  token → [paket, klasser…], klasstoken t = strängar[t − 1]; version 4 med strängpool i filen).
  Händelserna går genom `ProvenanceCore.intervalsFromEvents` som Wellbeing. Kontrollerat mot
  `dumpsys usagestats` och `abx2xml` på labbtelefonen (Android 13).
- `samsung-logs.js` (UMD `ProvenanceSamsungLogs`): Samsungs egna textloggar, som räcker längre bakåt än usagestats och appops.
  Se Samsungs loggar nedan.
- Telefonens egen tumnagel (`ProvenanceMedia.thumbnailSuffix`): iOS `PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG`,
  Android (10 och senare) `Pictures/.thumbnails/<_id>.jpg` för bilder och `Movies/.thumbnails/<_id>.jpg` för videor
  (MediaProvider, oavsett var filen ligger). Vallistornas tumnaglar laddas när raden syns (`lazyRowThumbs`,
  IntersectionObserver, en i taget): telefonens tumnagel, annars originalet upp till 8 MB, annars en bildruta ur
  en video upp till 64 MB (`videoFrame`). `suffixKeeper` slår upp sökvägarna på filnamnet först.
- `intervalsFromEvents`: PAUSED avslutar en app. STOPPED avslutar bara om ingen PAUSED väntar på sin STOPPED: när en app byter
  aktivitet kommer PAUSED för den gamla, RESUMED för den nya och en stund senare STOPPED för den gamla. Annars försvinner en app
  som byter aktivitet från förgrunden (Samsung-labbet: förgrundsapp saknades i 300 av 1 281 sekunder, hål på upp till 112 s).
  På en Pixel 9 utan loggad session, en dagsfil på 17 559 s: sekunder utan app med tänd skärm 231 före och 115 efter, av 2 517. Av 118
  nya sekunder med app var 2 med släckt skärm, och en app låg som mest 2 s kvar ovanpå en annan (7 s totalt). Rättningen är inte körd
  mot `lab-android-nord.json`, vars zip inte fanns på datorn. Facit jämför bandets start och slut, så ett utslag där ska läsas som att
  bandet har blivit längre, inte som att appen bytts.
- usagestats skrivs till disk med 20–30 minuters mellanrum, så dagsfilen kan sluta före T. Intervall
  utan slut (app, skärm, lås) slutar därför där dagsfilen slutar (`addAndroidLogs`: `intervalsFromEvents(…,
  lastEnd)`), inte vid fönstrets slut. Efter loggens slut används `activityAt` i `timeline-core.js`: en app
  som använde kameran vid T (appops) eller en händelse med `active` inom 5 s (en apps egen loggrad för en
  åtgärd i appen, till exempel Signals logg när en bilaga sparas) gör att *App igång* och *Skärm* blir
  förenliga, med källan i raden och `via` till kolumnen Vid T.
- Android-filer utan `datetaken` (det Snapchat sparar till galleriet) får T = `date_added`
  (`androidCreatedFallback`, `file.createdFrom`). Är skaparappen Snapchat kopplas raden i
  `memories.db` som sparades inom fem sekunder (`linkSnapMemory` → `file.memory`, `file.capturedMs`):
  tagningstid, kamera, position, tidszon. Kamerafaktorn bedöms då vid tagningstiden.

Plan och provkörning: [PLAN-harkomst.md](PLAN-harkomst.md).

#### Snapchat och "Var finns filen?" (beta)

- `queries/ios/snapchat/catalog.json` har fyra databaser som hittas på **suffix** i appens behållare
  (GUID:t varierar): `Documents/global_scoped/cachecontroller/cache_controller.db`, `arroyo/arroyo.db`,
  `DocObjects/primary.docobjects` och `databases/nse_db.sqlite`. Synliga queries för manuell kontroll
  i Queries, dolda rollqueries för Härkomst. Tiderna är Unix-millisekunder (`{{unixMsStart}}`).
- `queries/android/snapchat/catalog.json` (1.31) har sex databaser under
  `data/data/com.snapchat.android/databases/` (`data/user/0/` normaliseras till samma): `native_content_manager/cache_controller.db`
  och `arroyo.db` med samma tabeller som iOS (plus `sender_id`, `created_on_device`, `remote_media_count`, `is_saved`),
  `main.db` (`Friend`), `client_notifications.db` (`Notifications`), `memories.db` (`memories_snap`:
  `snap_capture_time`, `create_time`, `front_facing`, `time_zone_id`, `latitude`/`longitude`) och `journal.db`
  (`journal_entry` + `journal.path`: mappen säger vad filen är, t.ex. `posted_story_snap`). Samma rollnamn som
  iOS så att `snapchat.js` läser båda; `script.js` väljer nyckeluppsättning per plattform (`snapKeys()`).
  Androids chattmedia har nyckeln `chat_snap.chat_snap-<id>`; id:t står som sträng i meddelandets protobuf
  (`messageForSnapId`). Cachefilerna ligger i `files/native_content_manager/com.snap.file_manager_3_SCContent_<konto>/`.
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

#### Signal på Android (beta, 1.37)

- Signals databaser under `data/data/org.thoughtcrime.securesms/databases/` (`signal.db`, `signal-logs.db`,
  med flera) är **SQLCipher** med Signals inställningar: lösenordet är databasnyckelns hex (64 tecken),
  PBKDF2-HMAC-SHA1 i 1 varv, HMAC-SHA1 per sida, sidstorlek 4096, reserv 48 (IV 16 + HMAC 20, avrundat).
  Nyckeln ligger i `shared_prefs/org.thoughtcrime.securesms_preferences.xml`
  (`pref_database_encrypted_secret`), krypterad med Keystore-nyckeln `SignalSecret`, och går inte att ta fram
  ur filerna. Extraktionsverktyg kan låsa upp den på telefonen och spara den: som
  `extra/Secrets/secrets.json` i zippen (`script_output` → `"sqlite db key"` och
  `"signal attachment key"` → `modernKey`, sett på en labbtelefon och i en rapport), eller i en egen nyckelfil med JSON-filen `android_keystore`
  (formatet för Signal inte kontrollerat). Undersökaren kan också klistra in nyckeln. Leverantörer nämns
  inte i programmet; filerna beskrivs efter sökväg och format.
- `tools/db-queries/sqlcipher.js` (`SqlCipher`): AES-256 (CBC för sidorna, CTR för bilagorna), HMAC och
  PBKDF2 i ren JS, synkront och likadant i Node och webbläsaren; SHA-1/SHA-256 ur `ToolboxHashing`.
  `SqlCipher.open(db, wal, lösen, 'signal', SqliteWal)` dekrypterar alla sidor, och `SqliteWal.apply` har fått
  `opts.page(bytes, sidnummer)` så att WAL-ramarna dekrypteras när de läggs på (kontrollsummorna gäller
  chiffertexten, som i SQLite). HMAC kontrolleras för varje sida; fel på sida 1 betyder fel nyckel.
  Testerna krypterar en databas med Nodes crypto och kontrollerar mot FIPS-197.
- `tools/db-queries/app-secrets.js` (`AppSecrets`): nycklarna ur `secrets.json` (`fromSecretsFile`),
  `android_keystore` (`fromKeystoreFile`) och inklistrad text. `ExtractionCore.loadDatabase(read, hit, lead, { cipher })`
  dekrypterar när katalogens databas har `cipher: "signal"`; utan nyckel kastas ett fel med `code: 'ENCRYPTED'`.
  Queries läser nyckelfilen när zippen öppnas och visar nyckelraden under Källa när nyckeln saknas (eller
  efter **Annan nyckel…**); Härkomst har rutan under databaslistan.
- `queries/android/signal/catalog.json`: `signal.db` (meddelanden, bilagor med SHA-256 i hex via en rekursiv
  CTE som avkodar base64, en bilaga efter SHA-256, kontakter, konversationer) och `signal-logs.db`
  (händelser i loggen, hela loggen). Rollerna för Härkomst: `attachments` (alla, ingen tidsgräns),
  `messages`, `recipients`, `log` och `coverage`.
- Bilagorna: `attachment.data_hash_start` är SHA-256 (base64) för filen **före** Signals omkodning,
  `data_hash_end` för den lagrade. En bild ur galleriet som skickats har galleriets summa som `start`;
  en mottagen eller sparad bild har `start = end`, och en vidarebefordrad bilaga får samma summor och samma
  fil. Filerna `app_parts/partN.mms` är AES-256-CTR med noll-IV och nyckeln HMAC-SHA256(`modernKey`,
  `data_random`). En bilaga som sparas till galleriet heter `signal-ÅÅÅÅ-MM-DD-TT-MM-SS-mmm.ext` i
  `Pictures/Signal/`, med meddelandets `date_sent` (avsändarens klocka för ett mottaget).
- Signals logg (`log.body`, raden efter "GMT+01:00 D "): `MediaSendV3Activity` (kameran och medievalet),
  `Inserting attachment content://media/external/images/media/<MediaStore _id>` (vald ur galleriet; filens
  `pk` i MediaStore jämförs), `…securesms.blob/blob/single-session-disk/…` (Signals kamera eller
  redigeraren), `Inserted attachment at AttachmentId::N`, `IndividualSendJobV2: [date_sent][id] Sent message.`,
  `SaveAttachmentUtil: Save attachments completed`, `[deleteAttachmentsForMessage] mmsId: N` plus
  `RemoteDeleteSendJob` (raderat för alla). Loggen sparas bara några dagar.
- `tools/provenance/signal.js` (`ProvenanceSignal`): kopplingen (SHA-256 mot `start`/`end`, valen i loggen
  med filens MediaStore-id, sparandet, filnamnets tid), händelserna (`sig-message`, `sig-pick`,
  `sig-capture`, `sig-saved`, `sig-deleted`, `sig-log`) och hashsökningen i bilagorna (`findByHash`: SHA-256
  direkt, MD5/SHA-1 efter dekryptering). `script.js` kör `addSignal` efter att filen lästs (summan
  behövs), lägger fönster kring meddelandet och valet och kör om meddelandequeryn för dem.
  Ordningen i `assess()` är därför: bildfilen (EXIF, hashar), Signal, sedan fönstren och loggarna. Ett
  fönster kring en sändning eller ett val långt från T får då app, skärm, lås, kamera och grannar som de
  andra fönstren (före 1.40 lästes loggarna bara för fönstren runt T).
  `timeline-core.js` har faktorn **Signal** (`factorSignal`): sparad av Signal + träff = förenligt,
  kamerabild eller skärmdump som är en mottagen bilaga = inte förenligt, skickad = upplysning, saknas = saknas.
  Tidslinjen har raden Signal (triangel upp = skickat, ned = mottaget, cirkel = loggen).
- Kontrollerat mot en labbtelefon (Android 13, Signal 8.33, två sessioner 2026-11-02 med facit) och en
  verklig extraktion (Signal 8.10, nyckel i `secrets.json`). Labb-zippen
  `Lab-Android-Nord-2026-11-02.zip` har en `secrets.json` i samma format.
- Nycklarna tas var för sig (`AppSecrets.signalKeys`): databasnyckeln ur den första källan som har den och
  bilagenyckeln likaså, så att en inklistrad nyckel av det ena slaget inte döljer den andra i nyckelfilen.

#### Signal och WhatsApp på iOS (beta, 1.41)

- **Signal på iOS:** `grdb/signal.sqlite` i appgruppen `group.org.whispersystems.signal.group` är SQLCipher 4
  med en rå nyckel (profil `signal-ios` i `sqlcipher.js`). Nyckeln i nyckelringen (`svce`
  `GRDBKeyChainService`, `acct` `GRDBDatabaseCipherKeySpec`) är 48 byte: AES-nyckeln (32) och saltet (16).
  De första 32 byten i filen är okrypterade (SQLite-huvudet), så saltet står inte i filen och filen börjar
  med `SQLite format 3`. Sidorna har HMAC-SHA512 (HMAC-nyckeln: PBKDF2-HMAC-SHA512(nyckel, salt ^ 0x3a,
  2 varv)), sidstorlek 4096 och reserv 80. `SqlCipher.isEncrypted(bytes, profil)` känner igen en sådan fil
  (reserven i byte 20 och att sidan efter huvudet inte är ett b-träd), och `DbIdentify.kindOf` gör samma
  sak för en fil från disk. Kontrollerat mot en labbtelefon (iOS 26.4.1, Signal 8.28): alla 695 sidor.
- **Nyckelringen** finns i två former, och formatet avgörs av innehållet (`AppSecrets.readKeyBytes`):
  - `…_keychain.plist` bredvid zippen är en plist (binär eller XML) med posterna öppna i `genp`, `inet`,
    `keys` och `cert` (`fromKeychainPlist`, `parseXmlPlist`).
  - `extra/KeychainDump/backup_keychain_v2.plist` i en UFED-zip är en XML-plist med varje post krypterad
    (iOS keychain version 8, `fromKeychainEntries`): `keychainEntries` (`table`, `classKeyIdx`,
    `metadata { wrappedKey, ciphertext, tamperCheck }`, `data { unwrappedKey, ciphertext, tamperCheck }`) och
    `classKeyIdxToUnwrappedMetadataClassKey`. `wrappedKey` och `ciphertext` är NSKeyedArchiver-plistar
    (`_SFAuthenticatedCiphertext`: `SFCiphertext`, `SFAuthenticationCode`, `SFInitializationVector`) med AES-256-GCM
    och IV på 32 byte. Klassnyckeln öppnar `wrappedKey`, som ger metadatanyckeln, som öppnar metadatan.
    `unwrappedKey` öppnar värdet. Innehållet är DER (`KC.asn1.parseRecord`), `TamperCheck` ska vara samma som i posten, och
    fälten heter som i den öppna plisten. Bara värdet i Signals post dekrypteras. Kontrollerat mot två riktiga filer
    (789 och 707 poster, alla med metadata och värde): varje GCM-kontroll och `TamperCheck` stämmer. Ingen av telefonerna
    har Signal. Den riktiga nyckeln ur en öppen plist, inpackad i den här formen med testernas byggare, öppnar den riktiga
    databasen (695 sidor, inga HMAC-fel), men att extraktionsverktyget skriver Signals post på samma sätt som de andra är inte sett.
- **Var nyckeln letas** (`ExtractionCore.findKeys`, bara när extraktionen har en krypterad databas): nyckelfiler
  under `extra/` högst upp i zippen (`isExtraKeyPath`; längre ned ligger telefonens egna filer), nyckelfilerna i en
  rapport (`report.keychains`, se Rapporter) och, om inget av det hade Signals nyckel, filer bredvid zippen. Mappen läses bara i skrivbordsappen, eftersom
  en webbläsare inte får se den, och nås via navet: extraktionskoden når aldrig huvudprocessen (testet
  i `zip.test.js`), så verktyget skickar `keys-beside` och navet frågar `forensicsMedia.keysBeside`
  (`electron/key-files.js`). Bara vanliga filer vars namn ser ut som nyckelfiler öppnas, och bara för läsning.
  `AppSecrets.besideKeyFiles` väljer: samma enhets-id i namnet avgör, annars duger en enda fil utan ett annat
  telefon-id. Flera eller en annan telefons väljs aldrig, utan nämns i beskedet (`missingKeyText`), eftersom en mapp
  kan ha flera telefoners extraktioner. En fel nyckel kan ändå inte ge fel data: HMAC på sida 1 stoppar den.
- **Reserven:** undersökaren väljer filen tillsammans med zippen i raden högst upp, eller med **Nyckelfil…** i Queries
  och Härkomst, eller klistrar in nyckeln. Ordningen är inklistrad, vald fil och sedan det programmet hittade. En vald
  fil gäller extraktionen den valdes för (`forFile`), så att den inte följer med till nästa telefon. En zip som nyckelfil
  (`…_android_keystore.zip`, med JSON-filen `android_keystore`) packas upp i minnet (`ExtractionCore.readKeyFile`).
  Navet håller valda nyckelfiler med extraktionen (`extraction.keys`) och skickar dem till verktygen med
  `extraction-keys`; ett verktyg som valt en nyckelfil skickar den till navet på samma sätt. Det som hittas
  av sig självt går inte via navet: varje verktyg letar när det öppnar extraktionen. `AppSecrets.keysForProfile` väljer
  nyckeln efter profilen (64 hextecken för Android, 96 för iOS).
- **Signals egna krypterade filer** (`app_parts/part….mms` på Android, `attachment_files/XX/…` på iOS): summan kan aldrig stämma med
  bilagans, som gäller innehållet före krypteringen, och ExifTool kan inte tolka dem. Bedöms en sådan fil pekar raden i databasen
  ut den i stället (`data_file`, `localRelativeFilePath`, `on: 'file'`), och meddelandet märks som filens. En rad utan meddelande sägs,
  eftersom det kan vara en berättelse (5 av 11 filer på labbtelefonen, i `StoryMessageAttachmentReference`). Kontrollerat i rapporten från
  Android och på iOS-labbtelefonen. Samma namn i en annan app, till exempel Molly, är inte Signals fil.
- `queries/ios/signal/catalog.json`: meddelanden, bilagor (SHA-256 i hex, `sourceFilename`), en bilaga efter
  SHA-256, samtal (`CallRecord`), konversationer och kontakter. `recordType` 21 skickat, 19 mottaget, 20 samtal
  (Signals `SDSRecordType`, kontrollerat mot data). Rollerna: `attachments`, `messages`,
  `recipients`, `coverage`.
- `ProvenanceSignal.buildIos`: kopplingen på SHA-256 (`sha256ContentHash`, den lagrade bilagan) och på namnet
  (`sourceFilename`, utom Signals egna `signal-ÅÅÅÅ-MM-DD-TTMMSS.jpeg` som ges till alla bilder utan namn),
  namnets tid för en bild som Signal sparat, och händelserna (`sig-message`, `sig-call`). Signal kodar om
  bilder, så en bild ur bildbiblioteket som skickats har inte bilagans summa: faktorn säger då **Ingen
  koppling**, inte att filen saknas i Signal.
- **WhatsApp på iOS:** `ChatStorage.sqlite` i `group.net.whatsapp.WhatsApp.shared`, okrypterad. För
  mediefiler är `ZWAMEDIAITEM.ZVCARDNAME` filens SHA-256 i base64 och `ZVCARDSTRING` MIME-typen (kontrollerat
  för åtta filer; för ett kontaktkort är det namnet och vCard). En fil som valts ur bildbiblioteket har
  bibliotekets id (`UUID/L0/001`) i `ZMETADATA`, som SQL:en plockar ut med `instr`/`substr` och som jämförs
  med `ZASSET.ZUUID` (nu i Photos-rollen `file`). Finns flera `ChatStorage.sqlite` väljer Härkomst den i
  WhatsApps appgrupp (behållarens `MCMMetadataIdentifier`).
- `tools/provenance/whatsapp.js` (`ProvenanceWhatsApp`): kopplingen på summa, bibliotekets post och sökväg
  (filen under `Message/`), den möjliga kopplingen för en bild som WhatsApp sparat (det första skickade
  meddelandet med en bild inom en minut, som inte valts ur bildbiblioteket; bara tiden binder) och
  händelserna (`wa-message`). `timeline-core.js` har faktorn **WhatsApp** (`factorWhatsApp`), och en
  fil under `Message/` bedöms som WhatsApp-media (`file.chatMedia`): hypotesen är att den togs emot eller
  skickades i WhatsApp, och kameran frågas inte.
- Hashsökningen i Härkomst jämför SHA-256 med Signals och WhatsApps summor direkt (`chatHashLookupIos`).
- Appversionerna på iOS för Signal och WhatsApp kommer ur `Signal.app/Info.plist` och `WhatsApp.app/Info.plist`.
- Tester: `tools/db-queries/fixtures/chat-schemas.json` har tabellernas `CREATE TABLE` ur labbtelefonen
  (utan data), och varje query förbereds mot dem. Röktestet har en krypterad Signal-databas, en påhittad
  nyckelring och WhatsApp med HTML i namnen. `tests/app/lab-ios.js` kontrollerar labbzippen
  (`FT_LAB_IOS_DIR`) mot `facit/lab-ios-signal-whatsapp.json`. De förväntningarna är inget facit ur
  anteckningar, utan kontrollerade mellan källorna i extraktionen.
  `facit/lab-ios-tidsstamplar.json` (`FT_LAB_IOS_LOG_DIR`) är ett facit ur en labbsession med loggad ordning
  (2026-11-04).

#### Stora extraktioner (1.46)

- **`ZipRead.cacheDirectory`** lägger förteckningen på `read.directory`, och `scan` känner igen den: namnen avkodas
  en gång (`directoryIndex`), och varje `keep` går sedan bara igenom listan. Posterna skapas på nytt vid varje sökning,
  eftersom `extract` kan ändra dem. Större förteckningar än `MAX_CACHED_DIRECTORY` läses från disk som förut.
- **`SqlCipher.openAsync`** ger samma bytes och siffror som `open`, men med WebCrypto (`decryptBatch`). AES-CBC körs
  i ett anrop på 8 MB sidor i följd, och första blocket i varje sida rättas med sidans IV. Ett anrop per sida ger bara
  en tredjedel av hastigheten. HMAC kontrolleras per sida. Utan WebCrypto, eller om ett anrop misslyckas, används `open`.
  `open` finns kvar som referens i testerna.
- **`yieldToApp`:** WebCrypto-svaren körs före allt annat i sidan, så utan en paus står appen still tills hela databasen
  är klar (uppmätt: 1 366 ms utan, som längst 78 ms med). `setTimeout` bromsas i ett dolt fönster, därför `MessageChannel`.
- **`SqliteWal.plan`** räknar ut vilka ramar som ska läggas på, så att `openAsync` kan dekryptera dem i förväg.
- **Listor i slingor:** `lista = lista.concat(...)` per rad är kvadratiskt. Det kostade 67 av 73 s i Telegrams avkodning
  (200 000 meddelanden). `postbox.test.js` har ett hastighetstest för det.
- **Kvar:** `TelegramPostbox.attach` körs i huvudtråden.

### Rapporter (UFDR, `tools/db-queries/ufdr.js`)

En UFDR är rapporten som Cellebrite Physical Analyzer skriver. Namnen står bara här och i kodens kommentarer: programmets texter och protokoll säger rapportverktyget. Queries och Härkomst läser den som en extraktion:
`UfdrRead.open()` läser `report.xml` och bygger en innehållsförteckning i minnet i samma form som en zips, med telefonens
sökvägar som namn och rapportens egna poster som plats (`read.directory`, med `built: true`). `ZipRead.scan`, `extract` och
`stream` fungerar sedan som vanligt, med CRC32-kontroll mot posten i rapporten. Rapportens uppgifter ligger i extrafältet
0x5546 som JSON och blir `entry.report` (`member`, `sha256`, `md5`, `tags`, `deleted`, `deletedMs`, `origin`, `originReason`,
`service`, `adjustedTime`, `adjustedLocation`, `noData`). `zip.js` läser fältet bara i en byggd förteckning, så att en vanlig
zip inte kan låtsas ha rapportens tider. Inget skrivs, och förteckningen hålls i minnet tills källan stängs.

`report.xml` var 489 MB och 1,2 GB i de två rapporterna, större än en sträng i V8 får vara. Den läses därför i bitar, som byte, med en
egen genomgång av taggarna (`createScanner`), som klarar att en tagg delas var som helst. Metadata utom avsnittet `File` hoppas
över, och läsningen stannar vid `</taggedFiles>`. Det tog 1,7 och 4,5 s i Node och 2,2 och 5,6 s i Electron på en Mac.
Varje verktyg läser rapporten en gång. `DbData/database.db` (en pg_dump) innehåller samma filer och tider i tabellerna
`Nodes` och `ReportPaths`, men schemat är Physical Analyzers interna och äldre rapporter saknar den, så den används inte.

Formatet är inte dokumenterat. Det här är vad två rapporter från Physical Analyzer 10.11.0.3022 (`reportVersion` 8.5) visar,
skapade 2026-11-05 ur samma GrayKey-zip från iOS-labbtelefonen, en med och en utan okategoriserade filer. Rapporterna är
jämförda fil för fil med zippen (630 910 poster, 352 747 filer), utan programmets kod:

| | Utan okategoriserade | Med okategoriserade |
|---|---|---|
| `<file>` och `RelatedNodes` (= `NodeCount`) | 124 118 | 322 773 |
| Filer från telefonen, med samma sökväg, storlek och CRC32 som i zippen | 115 023 | 311 807 |
| Filer i zippen som rapporten inte nämner | 237 724 (67,4 %) | 40 940 (11,6 %) |
| Utvunna ur andra filer, visas inte | 9 017 | 10 720 |
| Rader som räknas som filer men inte finns i zippen | 77 | 245 |

- **Innehållet är samma byte.** 0 avvikelser i CRC32 och storlek. MD5 och SHA-256 i `report.xml` stämmer för alla 280 443 respektive
  95 663 poster under `files/`, omräknade med Python. HEIC är kvar som HEIC; omvandlingen till JPEG var inte på (provat bara så).
- **Sökvägen** i `path` är exakt zippens namn, med inledande `/`. `Local Path` i avsnittet `File` är posten i rapporten, med `\`.
- **Samma innehåll på flera ställen** ligger en gång och listas under `RelatedNodes`, med egna sökvägar och tider.
- **Tom fil:** raden pekar på en post som inte finns, och MD5 och SHA256 är `N/A`. Posten får `noData` och läses som tom.
- **Tiderna:** `ModifyTime` är zippens första tid, `AccessTime` den andra och `CreationTime` den fjärde, utan undantag. Det
  bekräftar tolkningen av UT-fältet som annars bara är härledd. **ctime finns inte i de här rapporterna:** `ChangeTime` är tom i alla
  rader, både i `report.xml` och i `Nodes`, och tabellen i Härkomst säger det. T och slutsatserna påverkas inte. I en rapport ur en zip med
  `metadata.msgpack` finns den, se nedan. `ChangeTime` läses i `accessInfo` och `CoreFileSystemFileSystemNodeChangeTime` i
  `MetaData` (skrivsättet i `MetaData` är kontrollerat på de andra tiderna, 842 969 värden, och själva fältet bara med byggda testfiler).
- **1980 är ingen tid.** En fil utan tider i zippen (491 filer) får `ModifyTime` 1980-01-01 00:00:00 och inga andra tider, och det
  görs till ingen tid. En äkta 1980 (1 fil) har de andra tiderna kvar och står kvar. En tid utan zon i texten räknas inte.
- **Rader utan fil på telefonen:** `embedded="true"` (`….car_embedded_1.jpg`, `signal.sqlite.decrypted`) eller en fil i sökvägen
  (`…/foo.zip/bild.jpg`). De visas inte, eftersom sökvägen inte finns på telefonen. Finns föräldrafilen inte i rapporten går det inte
  att se: 180 sådana rader räknas som filer. 65 rader har styrtecken i namnet som rapporten skrivit om och stämmer därför inte med zippen.
- **Nyckelringen** har `fs="Keychain"` och sökvägen `/Imported GrayKey Keychain/…_keychain.plist`. Den läses automatiskt, och Signal
  låses upp utan att något väljs. Saknas nyckeln i rapporten letas bredvid rapporten, som bredvid en zip.
- **Urvalet:** vilka filer som saknas står ingenstans. Saknas `Uncategorized` sägs det, men också med den saknas filer: under
  `/private/var/mobile/` 1 594 på 52 MB, bland annat `-shm`, kartresurser och 20 databaser på 4 096 byte, och utan den 17 023 på 2,3 GB. Ingen `-wal`
  med innehåll saknas i någon av rapporterna, och alla 14 databaser som katalogerna känner igen finns i båda. Varför filerna saknas är okänt.
  Därför säger texterna "i rapporten" och att frånvaro inte säger något om telefonen (`absentNote()` i Härkomst, `limitText()`).
- **Hashsökning:** summorna i `report.xml` läggs i Härkomsts cache (`fillHashCache`), så en sökning på MD5 eller SHA-256 läser inga filer.
  SHA-1 finns inte i rapporter och räknas som förut.
- **Rapportverktygets tolkning** (`MediaOrigin`, `MediaOriginReasoning`, `ServiceIdentifier`, `deleted`, `DeletedTime`, `AdjustedTimestamp`) står i en egen grupp
  på filkortet och i protokollet och används inte i bedömningen. Undantag: `AdjustedLocation` ger samma upplysning som attributet
  `customLocation` i en zip, eftersom xattr inte finns i rapporten. Bara IMG_0008 har fältet, och det är den enda bilden där loggen säger att platsen ändrades.
- **Inte läst:** `decodedData` (meddelanden, platser och annat som Physical Analyzer tolkat, samma 11 779 poster i båda rapporterna, 29 MB),
  `extraInfos` (var det tolkade kommer ifrån), `carvedFiles` (tom här) och `DbData`.

Härkomst är jämförd i appen: alla 34 rader i bildbiblioteket och tre filer utanför gav samma T, samma sammanvägning och samma svar i
alla faktorer mot zippen, utom positionen på grund av `customLocation` ovan. Alla 74 körbara queries gav samma rader. Signals databas, dekrypterad av
programmet, har samma rader i alla 92 tabeller som Physical Analyzers `signal.sqlite.decrypted`; sidorna skiljer sig bara i reservytan och i två byte i
huvudet (18 och 19, WAL-läget). Inte provat: en rapport med HEIC som JPEG, en skyddad rapport (känns igen på att
den inte är en zip, med ett besked), rader med `deleted="Deleted"`, flera filsystem med samma sökvägar, en rapport över cirka 320 000 rader, och äldre generationer annat än
med byggda testfiler och ett handgjort exempel (`FlorianRudolf/autopsy-udfr`, `reportVersion` 5.3.1.0, deflate, utan SHA-256).

#### Rapporter ur en zip med `extra/` (UFED)

Två rapporter till, skapade 2026-11-06 med samma version av Physical Analyzer, ur `EXTRACTION_FFS.zip` från en iPhone (iOS 18.7.7) och en
Samsung (SM-A336B, Android 16). iPhone-rapporten är jämförd fil för fil med zippen, utan programmets kod. Zippen från Android finns inte här.

| | iPhone | Android |
|---|---|---|
| `<file>` och `RelatedNodes` (= `NodeCount`) | 293 961 | 50 423 |
| Filer från telefonen | 288 109 | 38 615 |
| Utvunna ur andra filer, visas inte | 5 851 | 11 807 |
| `ChangeTime` ifylld | 287 971 | 0 |
| `report.xml` | 1,1 GB | 185 MB |
| SHA-256 i `report.xml` stämmer med posten, omräknat med Python | alla 254 928 | alla 42 243 |

- **Sökvägen:** `fs` är zippens namn på alla rader, också nyckelfilerna. På iPhone är `/root/…` zippens `filesystem1/…`, och på Android ligger filerna direkt
  (`/data/…`). `locate.js` jämför bakifrån, så inget behövde ändras.
- **Nyckelfilerna** flyttas högst upp, utanför telefonens filsystem, och har inget `fs="Keychain"`: `extra/KeychainDump/backup_keychain_v2.plist` blir
  `/backup_keychain_v2.plist` (samma byte, kontrollerat mot zippen) och `extra/Secrets/secrets.json` blir `/Secrets/secrets.json`. Rapportens `<image key="Keychain">` och `<image key="KeyStore">`
  nämner dem, med samma zip som källa. `classify` känner igen dem på platsen (`KEY_ROW`), och telefonens egna (`/root/private/var/Keychains/…`) står kvar som filer. `/Secrets/gen_mem.dat` är inte heller en fil på telefonen och visas inte.
- **Tiderna på iPhone:** alla fyra (`ModifyTime`, `AccessTime`, `CreationTime`, `ChangeTime`) stämmer med `metadata.msgpack` på alla 287 919 rader som finns där. **`ChangeTime` är filens ctime.** Rapporten
  avrundar till millisekund, över tiondels mikrosekunder, så 41 av cirka 1,15 miljoner värden skiljer 1 ms från en vanlig avrundning. 190 rader finns inte i `metadata.msgpack`, eftersom namnet har styrtecken som rapporten skrivit om.
- **Tiderna på Android:** ingen ctime, och `CreationTime` bara på 4 272 rader. 3 094 av dem ligger under `/apex/…` med `CreationTime` 1970-01-01 00:00:01 och `ModifyTime` 1980-01-01. De visas som de står. Regeln att 1980 är ingen tid gäller bara när inga andra tider finns.
- **`deleted="Unknown"`** (11 och 393 rader) finns bara på det som utvunnits ur andra filer, som inte visas.
- **Signal på Android:** `secrets.json` i rapporten låser upp `signal.db` och `signal-logs.db`: alla 834 + 972 och 1 522 + 666 sidor med `-wal`, inga HMAC-fel. Rapportverktygets kopia har samma rader i alla 59 tabeller,
  utan och med `-wal` (12 038 och 12 032 rader). Kopians `signal.db.decrypted-wal` går inte att lägga på som den är: kontrollsummorna gäller de krypterade sidorna och sida 1 är inte rätt dekrypterad, så ramarna lades på för hand, utom sida 1. Alla andra 835 sidor är lika utom reservytan.
- **Jämförelsen i appen:** iPhone-rapporten och zippen ger samma rader i alla 38 körbara queries, och på alla 89 filer samma T, samma tidpunkter, samma sammanvägning, samma svar i alla faktorer och samma tider i tabellen, också ctime. Skillnaderna är
  sökvägens prefix, källans namn och att rapporten säger att en fil kan ha valts bort. På Android kördes 34 queries och 14 filer utan fel, men utan en zip att jämföra med.
- **Läses inte:** Molly (`im.molly.app`, en fork av Signal, med egen `signal.db` utan nyckel i `secrets.json`) och Samsungs Wellbeing (`com.samsung.android.forest/databases/dwbCommon.db`). Rapportverktyget tolkar det senare.

### Samsungs loggar

`tools/provenance/samsung-logs.js` läser tre textfiler som bara finns på Samsung. `addSamsungLogs` i `script.js` läser filerna en gång per extraktion (`state.zip.samsungCache`) och lägger raderna i samma listor som usagestats och appops. Allt är kontrollerat på en telefon (SM-A336B, Android 16): först en rapport, sedan en zip från en loggad session (`tests/app/facit/lab-samsung-a33.json`, `FT_LAB_SAMSUNG_ZIP`).

- **SSRM** (`com.sec.android.sdhms/ssrm_heating_N.log`, 20 filer på cirka 1000 rader som skrivs i tur och ordning): `[PKG] <paket>` är appen i förgrunden, `[SET] … [LCD] ON/OFF` skärmen, `[SET] … camera running :: true/false  client : <paket>` kameran med appen som använder den (i en längre session också var tionde sekund, med ` info : MODE=0; …` efter). `[VER] <bygge> START/SHUTDOWN` och `===== ABOVE LOGS ARE FROM LAST BOOTING =====` är omstarter. Tiden är lokal utan zon; `[RTC] a b  <UTC-text> <unixtid>` ger zonen, och två rader som säger olika gör tiden mellan dem osäker. Raderna från en start till första `[RTC]` (inom en minut) har dock den radens zon: skärmen tänds på dem, och i labbet hade zonen bytts under de 28 dagar telefonen låg låst. Ett uppehåll på mer än en timme är ett hål i loggen. `START` kommer efter första upplåsningen, inte vid start, så telefonen kan ha varit igång under ett hål. Filerna täcker månader på en telefon som mest ligger still, kanske en vecka på en telefon i daglig användning. Det är en uppskattning ur mätt radtakt: cirka 470 rader i timmen vid användning (245 rader på 31 minuter i labbet) och cirka 75 i timmen när telefonen ligger still, av 20 000 rader.
- **Batterihistoriken** (`/data/log/batterystats/newbatterystatsYYMMDDHHMMSS`, 40 filer, upp till 26 MB, alla tolkas på cirka 1,2 s på en Mac): en utskrift från `batterystats` varje gång historiken nollställs, så filen täcker tiden från förra filens namn till sitt eget, med ett tak på 4 MB binärt som kan ta bort de äldsta raderna. Raderna har en av två former: `+1h37m42s570ms (1) 081 +camera` eller `05-22 12:24:57.537 078 c4900011 +camera`. Bara `+top=`/`-top=`, `+screen`/`-screen`, `+camera`/`-camera`, `TIME:`, `START` och `SHUTDOWN` läses. Nyare rader säger vem som använder kameran: `+camera +state=10330:"camera"`, och paketet är det med den uid:n på raderna med `top=` (också senare i filen; `u0a330` är 10330). Uid 1000 delas av flera systemappar, och en uid som inte finns i filen ger ingen app. Rader utan `+state` (på den här telefonen före 2026-03-19) säger inget om appen: `pkgactive=` på samma rad är en annan händelse, och appen är den i `+top` just då. Det är inte alltid samma: i labbet startade Snapchat kameran medan frågan om behörighet låg överst. Appen ligger kvar i `top` medan skärmen är släckt, så intervallet kapas vid `-screen` och tas inte upp igen vid `+screen` (det kan vara låsskärmen). Tiden är lokal i zonen när filen skrevs, med zonens regler för varje datum. Zonen är filnamnet mot ändringstiden i UTC. Säger förra filen en annan zon spänner filen över ett byte, och raderna räknas inte, för sommartid och resa går inte att skilja åt.
- **Klockan i batterihistoriken:** en rad räknas fram från senaste `TIME:` och förfluten tid. `TIME:` skrivs ibland sent, när telefonen just har vaknat. Då får det ankaret för sen tid, och raderna efter ligger för sent tills ett senare ankare stegar tillbaka, utan att telefonens klocka har ändrats (usagestats och SSRM påverkas inte). Labbet: +163,0 s vid 09-30 08:22:04 och −161,7 s vid 09:48:07, och skärmen och apparna låg 160 s fel däremellan. `segmentClock` märker avsnittet: ett steg bakåt vid slutet, ett steg framåt vid början utom när nästa rad är `+running` (telefonen vaknade just då och steget är ett uppehåll i raderna, högst 10 s i labbet), och ett steg framåt på över en timme (klockan ställdes: raderna före är fel, raderna efter rätt). I den nyare formen syns bara förra radens tid, så ett steg framåt följt av en annan rad kan vara ett uppehåll och märks ändå: det gör 107 av 404 avsnitt osäkra, men bara 8 rader om app eller skärm fler än om bara `-running` räknades, eftersom telefonen sällan används i dem. I den äldre formen är steget exakt och räknas åt båda håll. Märkta rader (över 5 s) hamnar i `input.logUnsure`, får `kind: 'log-unsure'`, står i händelsetabellen med "tiden osäker", räknas inte i faktorerna och ritas inte i tidslinjen. Faktorn säger varför om ingen säker källa svarar vid T.
- **Ordning (`collect`):** för app och skärm gäller den starkaste källan som täcker tiden: usagestats eller Wellbeing, sedan SSRM, sist batterihistoriken. Kameran har ingen sådan ordning, eftersom flera oberoende källor är det undersökaren vill se: en rad per källa i faktorn, en händelse i förklaringen, och texten en gång i tidslinjen.
- **Källan** har filen, raderna och själva råraderna (`SSRM → ssrm_heating_3.log rad 738–788 → …`). Bilagan har filerna med storlek och CRC32, hur raderna tolkas, avsnitten med osäker klocka och råraderna i fönstret, med ankaret för den äldre formen. Täckningen har hål (`coverage.gaps`), så att faktorn kan säga "har inga rader från … till …".
- **Kontrollerat:** tiderna mot en fristående tolkning i Python: samma fil, rad och tid på alla 1 480 gränser för app, skärm och kamera. Alla 75 skärm- och kamerarader som rapportverktyget tolkat ur SSRM finns med, på sekunden; programmet har 6 skärmrader till, som står i filerna. Skärmen i batterihistoriken mot SSRM på 74 rader: de 8 rader där klockan bevisligen flyttats (41 s den 22 april, 6 s den 24 april och 160 s den 30 september) är alla märkta, och av de omärkta 61 raderna ligger 50 inom 5 s. Resten av de omärkta är omstarter, där SSRM börjar senare än skärmen, tätt följande skärmbyten som jämförelsen parade ihop fel, och en tid som bara finns i filen som saknas i rapporten. Den riktiga bilden 2026-03-12 13:31:11.726 (EXIF, MediaStore) ligger inom `+camera` 13:31:02,9 till 13:31:16,5.
- **Den loggade sessionen (2026-11-06, zip):** åtta kameraanvändningar av kamera-appen, Signal och Snapchat står alla i SSRM, batterihistoriken och appops med rätt app. Batterihistorikens `+camera` ligger inom 0,62 s från SSRM och `-camera` 0,55 till 2,17 s efter. Klockan flyttades högst 122 ms under sessionen. Förgrundsappen sekund för sekund under 21 minuter: usagestats och SSRM säger samma i 1 259 av 1 281 sekunder, och skillnaderna ligger vid appbyten. Appstarter mot usagestats: batterihistoriken median 78 ms, högst 358 ms (37 starter). SSRM missar appar som bara syns under någon sekund. 34 batterifiler och 15 SSRM-filer finns också i rapporten från samma telefon, med samma SHA-256. Resten av SSRM-filerna har skrivits om sedan dess, och `newbatterystats260319094906`, som saknades i rapporten, är tom på telefonen.
- **Skärmen tänd i veckor:** efter en omstart på laddning (`plug=ac`) har batterihistoriken `+screen` utan `-screen` i upp till 70 dygn på den här telefonen, och `-screen` kom 16 s efter att sladden drogs ur. Raden stämmer med loggen, men säger inte att telefonen användes. De långa raderna ligger i tiden före första upplåsningen: 1 699,5 h i ett spann på 1 701,9 h och 678 h i ett på 679,3 h. Där säger skärmfaktorn att telefonen inte låsts upp, med läget Upplysning.
- **eRR.p** (`/data/system/users/service/data/eRR.p`, text, 9,5 kB, 98 rader sedan 2022): `LOGM`, antalet rader och sista radens index (fyra byte var, minst värd först), sedan `<tid med zon> | <vad> | <kod> | <resten>`. `ON`, `REBOOT` och `SHUTDOWN` (`REASON: shell`, `recovery`, `no power`, `userrequested`, `device_locked_3days`) är det läget bygger på; `LPM` (laddning med telefonen avstängd, troligen) och `PLATFORM` står bara som händelser. Samsung dokumenterar inte filen, och koderna (`RP`, `KP`, `NP`, `OFFSRC`, `ONSRC`, `RSTSTAT`) tolkas inte utöver `PANIC:` för en krasch. Syskonfilen `RC.p` har räknare som stämmer: 34 `ON/RP`, 11 `ON/KP`, 3 `ON/NP`, 1 `PF_NT`. Rader med en tid före raden innan har fel klocka (batteriet helt slut, 2023 mitt i 2026) och räknas inte; raderna med `+0000` vid laddning är riktig UTC. En fristående läsning i Python ger samma 98 rader i zippen och 92 i rapporten.
- **Mot de andra loggarna:** `REBOOT` och `SHUTDOWN` ligger 6–11 s efter SSRM:s `[VER] … SHUTDOWN` (6 av 6) och inom 15 s från batterihistorikens `SHUTDOWN` (13 av 13 med rätt klocka). `ON` kommer olika på olika programvara. Från 2026-03-19 (A336BXXUEGYI8) kommer den 16–64 s efter batterihistorikens första `TIME:` efter `START` (9 starter). Före det kommer den 8–55 s efter första appen, alltså efter första upplåsningen, som mest 30,8 dygn efter starten. Därför gäller batterihistorikens start när den finns, och `off` kräver att batterihistoriken täcker hela tiden (`batteryCovers`). Annars blir det `unsure` ("Kanske avstängd"), också när en ny nedstängning står utan start emellan eller när rader med fel klocka står emellan. Att det behövs syns 2026-03-12: filer har ändringstider 10:21–10:26 fast ON-raden kom 10:38 och batterihistoriken saknar tiden.
- **Första upplåsningen** är första appen överst utom `com.android.settings` efter starten (`unlocks`, skärmen före upplåsningen hör till Inställningar) eller SSRM:s `START`. De två ligger 4–8 s isär på sex av sju, och den sjunde ligger i avsnittet där batterihistorikens klocka var 160 s fel. Ett tecken räknas från nedstängningen, inte från ON-raden, för ON-raden kan komma efter det. `bfu` kräver att batterihistoriken är utan hål från starten till tecknet, eller en SSRM-`START` utan SSRM-rader före. I de sex långa spannen på 183 dygn har ingen fil under `data/media`, `data/data` eller `data/user` en ändringstid, medan `data/log`, `data/misc`, `data/user_de` och `data/system` har det. Det stämmer med att appars data och telefonens bilder är krypterade till dess. Raden i batterihistoriken med Inställningar i ett sådant spann tas bort (`dropFallbackHome`): ingen öppnade Inställningar.
- **`device_locked_3days`** (5 rader): på de 4 som SSRM räcker till släcktes skärmen 0–9 s före SSRM:s nedstängning minus 72 h, därefter har SSRM inga `[PKG]`, bara 1–3 `[LCD] ON`. Omstarten kommer bara efter en upplåsning: mellan start och första upplåsning kommer ingen, också när det går 71 dygn. Namnet stämmer med Googles funktion "automatically restart if locked for three consecutive days" (Play-tjänsterna 25.14), men ingen källa knyter just den här raden till den. De 72 timmarna blir låsrader med strömmen `eRR.p`, tiden före första upplåsningen också.
- **Faktorn "Telefonen igång"** (`factorPower`) visas bara när svaret säger något: `off` och `bfu` är Inte förenligt för kamerabilder och skärmdumpar, och Upplysning för annat, eftersom tiden kan komma från en annan enhet. `unsure` och tider inom en minut (plus zonens och klockans marginal) från ett skifte är Upplysning. `on` ger ingen faktor, utan en mening i skälet när loggarna är tysta (`powerNote`). Raden Telefonen i tidslinjen finns bara när det finns något att rita. Filerna i batterihistoriken som täcker tiden från senaste nedstängningen till nästa rad läses också när de ligger långt från fönstret (`powerRange`), för starten kan ligga månader bort.
- **Zon i batterihistoriken:** hål räknas i lokal tid, för raderna har zonen för sitt datum. Med UTC gav ett byte av zon mellan två filer ett falskt hål på en timme (rättat samtidigt). Starterna och upplåsningarna får eRR.p:s zon när raderna före och efter säger samma. Övriga rader i en fil över ett zonbyte märks fortfarande "tiden osäker", fast eRR.p skulle kunna rädda dem.
- **Inte provat:** en annan Samsung-modell, en telefon i daglig användning, en skärmdump i en loggad session och om `cap=1(0)` på SSRM:s kamerarad (sågs en gång, första raden efter Snapchats bild) betyder att en bild togs. Signals meddelanden i sessionen, eftersom nyckeln inte finns i extraktionen. En kamerabild med T då telefonen var avstängd finns inte på labbtelefonen, så det fallet är bara provat med påhittade filer (de riktiga raderna prövas med loggfiler vars ändringstid ligger i spannen). Rubin läses inte än. Rubins `location_log` hade tre rader, alla från sessionen, inom 9 m från Snapchats position; raderna från 2026-09-30 var borta, så den räcker inte långt.

### Databaser över 1,5 GB

Den fasta gränsen `MAX_ENTRY` är borta. Det som tar stopp är minnet, och då ger `ZipRead.friendlyMemory` ett begripligt
besked. Mätt 2026-11-04 på en Mac med 32 GB och påhittade databaser på 5,3 GB:

| Spärr | Mätt | Så hanteras den |
|---|---|---|
| En array i Electron 44 (Chromium 152) | knappt 2 GB | Electron 45 (Chromium 156): minst 8 GB. Chrome 156: minst 12 GB |
| Alla arrayer i ett fönster, i Chromium | ca 14 GB | Färre kopior (nedan). Firefox 157 och WebKit 27.2 nådde 24 GB, som var taket i provet |
| `File.arrayBuffer()`, `Response.arrayBuffer()` | nej från 2 GB | `extract` och `readFile` läser i bitar till en färdig array |
| `crypto.subtle.digest` | nej över 2 GB | `ExtractionCore.sha256` räknar större data i JavaScript, bit för bit |

- **Kopior:** en krypterad databas låg i tre kopior samtidigt (läst, dekrypterad, `db.slice()` i `wal.js`) och två efteråt.
  Med `SqliteWal.apply(..., { owned: true })` återanvänds arrayen, om den är en hel egen buffert och inte en vy in i
  källan. `ExtractionCore.noCopy` lämnar arrayen till sql.js utan kopia (sql.js tar in filen med `slice()` och läser
  med `subarray()`). Härkomst använder den och släpper `loaded.bytes`. Queries använder den för SQL som bara läser
  (`QueryRunCore.readsOnly`, `openForReading()`), med `PRAGMA query_only`. Annan SQL, också en PRAGMA, får en egen kopia
  per körning (`openCopy()`), så att den inte kan ändra något som nästa körning läser.
- **Hela kedjan** (zip, CRC32, SHA-256, dekryptering, sql.js, varje byte läst och jämfört med Python) tar ungefär en
  minut på 5,3 GB krypterat, med en topp på ca 10,5 GB. Firefox och WebKit är inte provade i den storleken.
- **Större än så:** sql.js klarar ett eget objekt med `length`, `slice()`, `subarray()` och `set()`, så en databas kan
  delas upp i bitar. Det läste 5,3 GB i Electron 44, men skrivning (Telegrams tabeller) kräver mer arbete. Inte infört.

### Html-versionen

`tests/app/html.js` packar samma filer som html-zippen och kör röktestet i Edge eller Chrome under `file://`, med en
proxy som inte finns, så att inget når internet. Sedan samma sak utan JIT. CI-jobbet `htmltest` kör det i Edge på Windows
och därefter med riktiga policyer i registret: `DefaultJavaScriptJitSetting` 2, `EnhanceSecurityMode` 2 och
`URLBlocklist` `*` med `URLAllowlist` `file://*`. Provet skriver ut vad `edge://policy` säger och hur fort en slinga
går i JavaScript och WebAssembly. Jobbet stoppar inte releasen, tills det har visat sig stabilt.

Mätt 2026-11-04 i Edge 156 på en Windows-maskin i CI, med en slinga på 30 miljoner varv:

| Läge | `edge://policy` | JavaScript | WebAssembly | Röktestet |
|---|---|---|---|---|
| Ingen policy | | ca 130 ms | 8–25 ms | alla delar |
| `DefaultJavaScriptJitSetting` 2 | tillämpas | ca 440 ms | ca 390 ms | alla delar, en bedömning 7–12 s mot 1–2 s |
| `EnhanceSecurityMode` 2 | tillämpas | ca 430 ms | ca 365 ms | alla delar, samma tider |
| Bara `file://` | tillämpas, annan adress ger `ERR_BLOCKED_BY_ADMINISTRATOR` | ca 130 ms | 8–25 ms | alla delar |

- **Utan internet:** appen gör inga egna nätverksanrop. Onlinekartan används bara om den slås på.
- **Utan JIT:** beror på bygget. På Windows finns WebAssembly kvar i en tolk, så allt fungerar men långsammare. Då visar
  huvudfönstret `#browser-slow` (`wasmIsInterpreted()` i `src/script.js`: en slinga på 10 miljoner varv tar över 80 ms, två
  försök). På Mac tar `--jitless` bort WebAssembly: raden `#browser-notice` säger det direkt, och varje verktyg säger det när
  något ska läsas (`toolboxWasmProblem`). Med `--jitless --wasm-jitless` får Mac också en tolk. Rapporten om att
  html-versionen slutat fungera i en låst Edge är inte förklarad av detta: se Kända begränsningar.
- **Edge på Mac:** paketet från Microsoft är x86_64 och körs under Rosetta. Därför är det flera gånger långsammare där än
  Chrome (17 verktyg 61 s mot 3–4 s). Det säger inget om Windows, där samma prov tar 5–7 s.
- **Utan WebGL2** går bara kartan inte att rita. Chromium har aviserat att reservlösningen i programvara (SwiftShader)
  ska tas bort, men med `--disable-gpu` ritade både Edge 156 och Chrome 156 på Mac fortfarande med den. Provet utan
  WebGL2 kräver därför också `--disable-software-rasterizer --disable-3d-apis`.
- **Kartmappen** väljs med en vanlig mappdialog (`webkitdirectory`), eftersom `file://` inte får läsa `maps/`.
- **WebKit under `file://`:** en worker från en blob-URL får inte läsa en Blob. ExifTool-workern känner av det och får
  då bytena som `{ name, data }` (`blobsBlocked`). Riktiga Safari är inte provat.
- **Programversionen** kommer från `Toolbox.html` i verktygets adress (`?version=`), eftersom `package.json` varken
  följer med i zippen eller går att hämta under `file://`.
- **Kopiorna först:** `loadLocalJson` tar `catalog.js` före `fetch`, så att webbläsaren inte skriver röda fel i konsolen.

#### Kontrollerat mot den loggade labbsessionen (1.45)

- **Photos:** `ZIMPORTEDBY` 8 har setts för SpringBoard, Safari och Bilder, så skärmdump kräver SpringBoard eller
  `ZKINDSUBTYPE` 10. `ZIMPORTEDBY` 13 är AirDrop (en loggad mottagning) och står kvar när en dubblett skriver om
  `ZIMPORTEDBYBUNDLEIDENTIFIER` på originalet till `com.apple.mobileslideshow`. Bilder visar originalnamnet, inte
  `ZFILENAME`. `ZMODIFICATIONDATE` flyttas på filer som ingen rört.
- **Filsystemets tider:** ctime flyttas när utökade attribut skrivs (favorit, Raderade, ny tid, plats); ändrings- och
  skapandetiden står still. Det är en iakttagelse, inte dokumenterat av extraktionsverktyget. HEIC-filen skrivs
  färdig 5–50 s efter bilden. AirDrop och dubbletter behåller källans skapandetid.
- **0x4b47** i zippen har filens utökade attribut (`entry.customLocation`). `com.apple.assetsd.customLocation` finns när en plats satts i
  Bilder, men också på vanliga bilder med GPS i filen: 8 av 34 bilder i labbet har det, och loggen säger att platsen ändrades på en av dem (IMG_0008).
  Därför säger Härkomst att platsen är satt i efterhand bara när filens egen position saknas eller ligger mer än 50 m från bibliotekets.
- **Signal på iOS:** `wasNotCreatedLocally` är skickat från en länkad enhet, `hasSyncedTranscript` från telefonen.
  `expireStartedAt` på ett mottaget meddelande med försvinnande tid är när det öppnades, på telefonen eller en
  länkad enhet. Händelserna är `sig-opened` och `sig-story`.
- **WhatsApp:** typ 38 är engångsvisning. Bibliotekets id på ett mottaget meddelande betyder att filen sparats dit.
  Ett meddelande som tas emot medan appen är stängd finns bara i `Logs/ServiceExtension_*/` tills appen öppnas:
  `parseExtensionLog` jämför loggens id med `ZSTANZAID` (händelsen `wa-pending`, `link.pending`).
- **Chattappars `tmp/`:** `tmp/documents/Camera/` (WhatsApp) och `tmp/camphoto_…`, `tmp/camvideo_…` (Telegram) ger
  `file.chatTemp`. Telegrams filer ligger kvar också när bilden skickats, så bara tiden avgör om meddelandet finns.
- **Inga spår:** redigering i Signal, när ett samtal besvarades (`CallRecord` har bara starten) och "radera för mig"
  (bara ett hopp i `id`).

#### PowerLog på iOS (1.43)

- **Varför:** på iOS 26 slutade knowledgeC att registrera skärmen (`/display/isBacklit`), och Biome har
  inte skärm eller lås för samma tid (strömmarna `Device.Display.Backlight`, `Device.ScreenLocked` och
  `_DKEvent.Keybag.IsLocked` skrevs senast månader före i labbzippen). PowerLog har dem.
- **Filen:** `SystemGroup/<GUID>/Library/BatteryLife/CurrentPowerlog.PLSQL` (+ `-wal`), som databasen
  `powerlog` i `queries/app-usage/catalog.json`. Äldre dagar ligger i `Archives/powerlog_ÅÅÅÅ-MM-DD_….PLSQL.gz`.
  Ibland är den aktuella filen tom, och då finns allt i arkiven (sett på iOS 18.5).
- **Tabellerna:**
  - `PLDisplayAgent_EventPoint_Display`: skärmen, med `Backlight` och `Active` 1 eller 0.
  - `PLSpringBoardAgent_EventForward_SBBlank`: SpringBoards bild av skärmen.
  - `…_SBLock`: låset, `Locked`.
  - `PLScreenStateAgent_EventForward_ScreenState`: appen på skärmen. `AppRole` 1 är appen; andra roller
    ligger ovanpå, som Face ID, kontrollcentret och låsskärmen.
  - `PLCameraAgent_EventForward_Camera`: kameran per app. En rad med `State` 1 och `BundleId` startar en
    kamera, och en rad med `State` 0 stänger samma `CameraType`. Den visar också WhatsApps, Telegrams och
    Signals egna kameror.
- **Tiden:**
  - PowerLog skriver med en egen tid. Den rättade tiden är PowerLogs tid plus `system` ur
    `PLStorageOperator_EventForward_TimeOffset`, den senaste raden före händelsen. Rättningen görs i SQL,
    där händelsetabellen måste ha ett alias. Utan alias pekar `timestamp` i underfrågan på förskjutningens
    egen kolumn.
  - Förskjutningen var −903 till −908 s på labbtelefonen, −10 till 0 s på iOS 26.0 och cirka 1,76 miljarder
    sekunder på iOS 18.7, där PowerLogs tid räknas nära noll.
  - Utan förskjutningsrader blir den rättade tiden NULL, och raderna används inte.
- **Kontroll:**
  - **Labbtelefonen:** appen på skärmen och kameran stämmer med knowledgeC på ungefär en sekund, i 139 av
    142 par. Med den senaste förskjutningen för alla rader, som iLEAPP gör, avviker det 4–6 s.
  - **Skärmen mot `/display/isBacklit`:** −3 till +4 s med median +2 s på iOS 26.0, och −6 till +4 s på iOS 18.7.
  - Strax före ett byte av förskjutningen kan tiden avvika med bytets storlek.
- `tools/provenance/powerlog.js` (`ProvenancePowerLog`) gör övergångarna till intervall för skärmen,
  låset, appen och kameran.
  - Ett läge gäller till nästa övergång, men inte över ett glapp på mer än två timmar i PowerLogs täta
    tabeller (`role-pl-gaps`). Då var telefonen avstängd.
  - Kamerasessioner för samma app inom två sekunder slås ihop.
- **Härkomst** (`addPowerLog`):
  - Läser den aktuella filen och dagsarkiven vars datum ligger inom ett dygn från fönstret. Arkiven packas upp i
    minnet med `DecompressionStream('gzip')`, och varje arkiv är en egen källa i protokollet.
  - Skärm, lås och kamera per app läggs alltid till. Appen på skärmen läggs bara till när knowledgeC saknar
    `/app/usage` i fönstret.
  - Kameran per app är `cameraUse`, samma form som appops på Android, med `stream: 'PowerLog'`. Den har en
    marginal på 1,5 s mot T, i stället för 5 s.
  - Faktorerna säger källan. Täckningen och glappen står i texterna när registreringar saknas (`reasonAt`).
- Queries: förhandsvisningen hoppar över en `WITH` och tar kolumnerna ur huvudfrågan (`selectItems`).

#### Telegram på iOS (beta, 1.42)

- **Databaserna** ligger i appgruppen `group.ph.telegra.Telegraph` under `telegram-data/account-<id>/`:
  meddelandena i `postbox/db/db_sqlite` och lagringsdatabasen i `postbox/media/storage/db/db_sqlite`. De är
  inte krypterade när ingen lösenkod är satt i Telegram. Tabellerna `t0`, `t1`, … har nyckel och värde som
  blobbar i Telegrams eget format (Postbox).
- `tools/db-queries/postbox.js` (`TelegramPostbox`) avkodar formatet till tillfälliga tabeller i minnet när
  databasen öppnas: `tg_message`, `tg_resource` och `tg_peer` ur `t7` och `t2`, och `tg_storage` ur `t15` och
  `t16`. Queries, Härkomst och igenkänningen (`DbIdentify.rank`) anropar `attach`. Tabellerna finns inte i
  filen, och spårbarheten och protokollet säger att de avkodades.
  - **Formatet:** varje objekt bär sin klass som MurmurHash3 av klassnamnet (frö `0xF7CA7FD2`).
  - **Nyckeln i `t7`** är peer, namnrymd, tid (unixsekunder) och id, i big endian.
  - **Värdet** har flaggor (4 = mottaget), avsändare, text, attribut och media.
  - **En post som inte går att avkoda** står med i tabellen, med nyckelns uppgifter och felet i `decode_error`.
- `queries/ios/telegram/catalog.json` har två databaser med `derive`. Queryn **Kontroll: meddelandenas
  nycklar i t7** läser tid, id och peer ur nycklarna med vanlig SQL, så att avkodningen kan kontrolleras i
  ett annat verktyg.
- `tools/provenance/telegram.js` (`ProvenanceTelegram`) kopplar filen till Telegram på tre sätt:
  - **Filen själv** under `postbox/media/`: filnamnet är resursens id.
  - **En bild ur bildbiblioteket:** lagringsdatabasens resurs `ph-<ZUUID>_L0_001-…` har chatten och den
    uppladdade bildens storlek, och meddelandet är det i samma chatt med en bild av samma storlek.
  - **En bild som Telegram sparat:** den får en möjlig koppling till det första skickade meddelandet med en
    bild eller video inom en minut.
- `timeline-core.js` har faktorn **Telegram** (`factorTelegram`) och **Telegrams kamera**
  (`factorTelegramCamera`). Den senare gäller en fil som Telegram sparat med originalnamnet `camphoto_…` eller
  `camvideo_…`: samma SHA-256 som filen i Telegrams `tmp/` binder. Appversionen kommer ur `Telegram.app/Info.plist`.
- Kontrollerat mot en labbtelefon (iOS 26.4.1, Telegram 13.1.2, 2026-11-03), inte mot anteckningar. Bara det
  första kontot läses när telefonen har flera, och en varning säger det.
- **Tidslinjen** har rader för WhatsApp och Telegram, med meddelandena som trianglar.
- **CSV:** alla CSV-exporter (Queries, EXIF & karta, Positioner, App-id) sätter en apostrof före en cell som
  börjar med `=`, `+`, `-`, `@`, tabb eller vagnretur, så att Excel inte tolkar den som en formel. Vanliga tal
  lämnas som de är.
- **Tester:**
  - `tools/db-queries/fixtures/postbox-encode.js` kodar påhittade databaser i Telegrams format åt
    enhetstesterna och röktestet.
  - `tests/app/lab-ios.js` kontrollerar Telegram-kopplingarna mot labbzippen.

#### Appversioner i protokollet (1.40)

- `tools/provenance/app-versions.js` (`ProvenanceAppVersions`): versionen för apparna som bedömningen läste.
  iOS: `Bundle/Application/<GUID>/<App>.app/Info.plist` (`CFBundleShortVersionString`, `CFBundleVersion`),
  alltså versionen som var installerad vid extraktionen. Android: `data/system/packages.xml` (ABX eller
  text; `version` = versionskoden, `ut` = uppdaterad), Snapchats `memories_snap.snap_create_user_agent`
  (versionen när snappen togs: den kopplade snappen, annars snappen i fönstret närmast T) och Signals logg
  (raderna börjar med versionen, `[8.33.2]`; raden närmast T). `script.js` (`appVersions`) tar bara med
  appar som har händelser i fönstren eller som filen kommer från, och protokollets huvud får raden
  **Appversioner** (`meta.appVersionsText`).

#### En -wal som inte går att lägga på (1.40)

- Trasigt huvud, fel checksumma eller fel sidstorlek i `-wal`: databasen läses utan den, som SQLite gör, och
  det blir en varning i stället för ett fel (`ExtractionCore.loadDatabase` och `QueriesRun.load`). Varningen
  står bland Härkomsts varningar och i protokollet, och i Queries med röd text under resultatet.
  Bildbibliotekets egna varningar (utan `-wal`, CRC32) står också bland varningarna, eftersom filens rad
  kommer därifrån.

### ExifTool i EXIF-visaren

`tools/exif-viewer/vendor/exiftool/` byggs av `node scripts/vendor-exiftool.js` från
fastlåsta npm-paket (`@uswriting/exiftool`, `@6over3/zeroperl-ts`). Skriptet bygger
workern från `scripts/exiftool/worker-entry.mjs` med esbuild och lägger in
`zeroperl.wasm` gzippad som base64, så att inget hämtas under `file://`. Bara
`parseMetadata` importeras; skrivfunktionen finns inte i bundlen.
`exif-vendor.test.js` kontrollerar wasm-filens SHA-256 och läser en riktig bild med
workern. Byt version genom att ändra `PACKAGES` i skriptet och köra det igen.

Detaljrutan visar alla tider i filen (`ExifCore.timeTags()`): som de står i filen, med taggen och samma tid i UTC, eller
"ingen zon i filen". Filsystemets tider står för sig: ur zippen för en fil från Härkomst, annars för kopian på datorn.

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
- **Provkörning av appen** (`tests/app/`, `npm run test:app`): appen startas i Electron utan skärm
  (`harness.js`, samma protokoll och IPC som `electron/main.js`, ett offscreen-fönster, DevTools-protokollet
  på `FT_PORT`, standard 9223) och styrs av `cdp.js`. Saknas skärm (CI) körs Electron med
  `--ozone-platform=headless`; utan grafikkort finns ingen WebGL2, och kartan säger det i stället för att
  ritas. Testerna läser verktygen via `window.QueriesApp` och `window.ProvenanceApp` (bara läsning).
  Provkörningen kräver Node 22 eller senare (inbyggd `WebSocket`); enhetstesterna går på Node 20.
  - **Röktestet** (`smoke.js`, `--smoke`): alla verktyg laddas utan fel i sidan; Härkomsts tre testdata ger
    underlag och protokoll; en påhittad iOS 17-extraktion (`fixtures.js`: Photos.sqlite med iLEAPP:s schema,
    knowledgeC.db med en trasig `-wal`, routined, bildfiler och poster med HTML i namnet) öppnas i Queries
    och Härkomst; en query med noll rader sägs ut; en fil från disk väljer raden i rätt mapp; en källa i Härkomst
    öppnar rätt databas och markerar raden; exempelraderna är märkta och resultatet når kartan; en inläst databas
    läses inte om; en lista från disk bedöms; och HTML ur filnamn och databaser körs aldrig. Bara påhittade data. CI kör det i jobbet `apptest`, som inte stoppar
    releasen än.
  - **Facit** (`facit.js`, `facit/lab-android-nord.json`, `--facit`): Härkomst bedömer filerna i
    labbzippen och jämför T, Memories, förgrund, skärm, lås, kameran, Snapchats meddelande, Signals
    meddelanden och appversionerna med det som loggades på labbtelefonen (inom en sekund, Signal två).
    Labbzippen ligger inte i repot: sökvägen tas ur `FT_LAB_ZIP`, annars
    `~/Documents/Exampleextractions/Lab-Android-Nord-2026-11-02.zip`. Zippens storlek, mtime och ctime
    kontrolleras efteråt. Bara tider och versioner står i facit, inga namn eller nycklar.
  - **Nyckeln bredvid zippen** (`lab-ios.js`): labbzippen öppnas ensam, så att alla kontroller av Signal bygger på att
    nyckelringen hittades. I zippar från `FT_LAB_NAMED_ZIPS` öppnas nyckelringen under `extra/` med samma kod: alla poster, inga fel.
  - **Rapporter** (`lab-ios.js`): finns en `.ufdr` i en undermapp till labbmappen körs samma facit och samma fristående facit mot den, utom
    ctime, och nyckelringen ska läsas ur rapporten. Röktestet har en byggd rapport (`fixtures/ufdr-builder.js`), också i html-versionen.
  - **Rapporter ur en zip med `extra/`** (`ufedReportScenarios`, `FT_LAB_UFED_REPORTS`, med zippen efter `=` om den finns): rapporten öppnas ensam, nyckelfilen ska finnas i den och gå att läsa, och den ska inte stå bland telefonens filer.
    Signal, dekrypterad av programmet, jämförs med rapportverktygets kopia tabell för tabell. Med zippen jämförs tiderna med det fristående facit, också ctime, inom 1 ms.
  - **Filens tider mot ett fristående facit** (`lab-ios.js`, `time-facit.py`, kräver `python3`): skriptet läser zippens fält eller
    `metadata.msgpack`, EXIF, QuickTime och Photos.sqlite utan programmets kod och utan ExifTool. Zippar med `metadata.msgpack` anges i `FT_LAB_NAMED_ZIPS`. Varje rad i bildbiblioteket bedöms, och tabellen
    jämförs med facit: bibliotekets tider och tiden i filen på en millisekund, zippens tider exakt. Samma filer bedöms också i
    UTC och datorns zon, och slutsatsen och tiderna ska vara desamma (`zoneChecks` i facit-filen).
  - `FT_SHOTS=<mapp>` sparar en skärmdump efter varje del. En ny del är en post i `scenarios`, en
    asynkron funktion som kastar ett fel när något inte stämmer.
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
- **Html-versionen i en låst Edge:** en användare rapporterade att programmet inte längre gick att köra, troligen i en Edge
  som bara når lokala filer och intranätet. Orsaken är inte hittad. Internet, JIT, förstärkt säkerhet och `URLBlocklist`
  förklarar det inte (se Html-versionen). Inte provat: en äldre Edge, `AllowFileSelectionDialogs`, en spärr som också
  gäller `file://`, IE-läget (`SendIntranetToInternetExplorer` eller en webbplatslista) och att köra från en nätverksresurs.
- Härkomst: Android är provkört mot en labbtelefon (Android 13, LineageOS), inte mot en kommersiell extraktion; `usagestats` i XML (version 3, Android 9 och äldre) läses inte, den binära batterihistoriken (`battery-history/0.bin`) läses inte, ingen positionslogg läses på Android, bildfiler över 200 MB läses inte för EXIF, och inklistringen i Word är provkörd bara via urklippsstatus, inte i Word självt
- **Rapporter (UFDR):** formatet är inte dokumenterat, och läsningen är provad mot fyra rapporter från en version av Physical Analyzer. Se Rapporter (UFDR). Programmets texter och protokoll nämner inte verktygets namn, utan säger rapportverktyget.
- **Filens tider:** tolkningen av zippens tredje tid är härledd ur labbdata, och Apple dokumenterar inte Photos.sqlite. Inte
  provat: en vanlig video från Kamera-appen (labbarna har Live Photo-videor och två MP4 från appar), en bild från molnet
  (`ZDATECREATEDSOURCE` 0), Android mot det fristående facit och zippar från andra verktyg än de som provats. T följer bibliotekets
  tid också när den är ändrad, så kontrollerna av app och kamera körs då runt den ändrade tiden. Att tiderna stämmer visar att inget
  har ändrats efter importen, inte att tiden är sann.
- **Snapchat (beta):** typkoder och protobuf-tolkning är härledda ur en enda extraktion. Memories
  (`gallery.encrypteddb`) är SQLCipher och läses inte. Chattmedia är ofta krypterat på disk; nyckel och
  IV ligger i `message_content` men används inte. Flera Snapchat-konton i samma behållare: första
  träffen används. Android-Snapchat är kontrollerat mot en labbtelefon (Snapchat 14.30): typ 34
  (inspelning) sågs inte där, typ 5 utan attribution är bland annat media som laddas upp före ett skickat
  meddelande, och `memories.db` är okrypterat.
- **Signal (beta):** Android, kontrollerat mot Signal 8.10 och 8.33 och en rapport från en Samsung, och iOS, kontrollerat mot Signal 8.28. Utan nyckel (ingen
  `secrets.json`, ingen nyckelfil och ingen inklistrad) läses Signal inte. En separat nyckelfil
  (`…_android_keystore.zip`) hittas bredvid zippen i skrivbordsappen, men formatet för Signal är inte sett: labbtelefonens fil har
  fem andra appar. Signals logg sparas bara några dagar. En bild som redigerats i
  Signal har den redigerade versionens summa som `data_hash_start`, så originalet kan inte kopplas.
