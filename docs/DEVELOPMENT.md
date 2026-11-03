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
| `npm test` | Enhetstesterna under `tools/` (Node) |
| `npm run test:app` | Provkörning av hela appen i Electron: röktestet, och facit om labbzippen finns (se Tester) |

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
- Fälten sparas per namn i `paramMemory`: samma tidsspann eller filnamn står kvar när man byter query eller
  databas i fliken, och Enter i ett fält kör queryn. En annan query i samma databas (`selectQuery()`,
  händelsen `queries:query-change`) tömmer resultatet men behåller filerna och den inlästa databasen.
  Smalare än 980 px står sidopanelen överst.
- `tabs.js`: varje flik är ett sparat läge. Vid byte sparas `QueriesApp.snapshot()`,
  `QueriesRun.snapshot()` (filer, inläst databas, resultat) och `QueriesExtraction.snapshot()`, och
  den andra flikens läge läggs tillbaka med `restore()`. Extraktionen och filen från disk hör till fliken
  (`QueriesExtraction.snapshot()` ger `{ ex, chosen, loose }`), och en ny flik får programmets extraktion
  (`adoptShared()`), fristående den zip som är öppen, men ingen fil (`fresh()`).
- `openFromProvenance()`: samma zip, sökväg och SQL visar den flik som redan finns, annars används
  en tom flik eller öppnas en ny. `QueriesApp.showCustom()` visar SQL:en utan fält,
  `QueriesRun.run()` kör den, och `QueryRunCore.withUtcColumns()` lägger en kolumn `<namn> (UTC)`
  efter varje tidskolumn (samma epoker som `roles.js`).

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
  `report.js` bygger protokollet och förklaringen som HTML med inline-stilar för Word; båda
  får översikt, närbild och undersökarens egen bedömning (`meta.ownAssessment`).
  `keyEventsTable()` och `eventsTable()` ger nyckelhändelserna och händelserna med källa som egna
  tabeller för Word (knapparna Kopiera tabellen för Word); protokollets händelsetabell är samma.
- Från Härkomst till Queries: `runRole()` sparar zip-sökvägen och tidskolumnerna med varje query
  (`meta.queries[].path`, `walPath`, `timeColumns`). En klick på en källa skickar
  `{ type: 'open-query', file, path, sql, queryId, timeColumns }` till huvudfönstret
  (`src/script.js`), som öppnar Queries och skickar vidare. Filen (File-objektet för zippen) går
  med i `postMessage`; Queries öppnar den bara om den inte redan är öppen (namn, storlek, ändringstid).
- Zippens tider (`zip.js`): UT-fältet 0x5455 (Unix-sekunder; ändring, och åtkomst och skapande när
  flaggorna säger det, som i vissa verktygs FFS-zippar) och NTFS-fältet 0x000A (FILETIME; ändring, åtkomst
  och skapande, som i Arkiv-zippen), som går före UT. Info-ZIP skriver bara ändringen i
  innehållsförteckningen; åtkomst och skapande läses ur den lokala posten när posten läses (`extract`).
  Posten får `mtime`, `atime`, `crtime` (Unix-sekunder) och `timeField`; `ExtractionCore.entryTimes()` ger
  dem som text. Utan något av fälten finns bara DOS-tiden (lokal tid, zon okänd).
- Extraktionen läses med `tools/db-queries/extraction-core.js`, som Queries också använder. Bara
  läsning: testet i `zip.test.js` grep:ar alla filer i `tools/provenance/` efter skrivande API:er.
  Härkomst läser zippens innehållsförteckning en gång per öppnad zip (`ZipRead.cacheDirectory`)
  och söker sedan i minnet; posterna själva läses alltid ur zippen.
- Under en bedömning är knapparna som byter zip, fil eller testdata spärrade (`busy()`, `BUSY_IDS`), så
  att två extraktioner aldrig blandas i ett protokoll. Byte av zon eller fönster kör om den senaste
  bedömningen (`state.redo`), och undersökarens text och bockar hör till filen (`assessmentKey()`: zip
  och rad eller sökväg).
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
  och 26, de versioner som kontrollerats, och är bara reserv). På Android ur `usagestats` (app, skärm, lås) och `appops`
  (kameran per app), lästa som filer ur zippen av `android-logs.js`; Wellbeing är reserv.
- `android-logs.js` (UMD `ProvenanceAndroidLogs`): `abxParse` för Androids binära XML (ABX,
  magic `ABX\0`, internerade strängar, samma utskrift som `abx2xml`), `discreteOps`/`opIntervals`
  för `appops/discrete/<ms>tl` (op 26 = kamera; startraden och slutraden med `nd` har samma `nt`,
  slutraden kan ligga i en senare fil), och `usageMappings`/`usageDaily` för
  `usagestats/daily/<beginMs>` (version 5 `IntervalStatsObfuscatedProto` med `mappings`:
  token → [paket, klasser…], klasstoken t = strängar[t − 1]; version 4 med strängpool i filen).
  Händelserna går genom `ProvenanceCore.intervalsFromEvents` som Wellbeing. Kontrollerat mot
  `dumpsys usagestats` och `abx2xml` på labbtelefonen (Android 13).
- Telefonens egen tumnagel (`ProvenanceMedia.thumbnailSuffix`): iOS `PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG`,
  Android (10 och senare) `Pictures/.thumbnails/<_id>.jpg` för bilder och `Movies/.thumbnails/<_id>.jpg` för videor
  (MediaProvider, oavsett var filen ligger). Vallistornas tumnaglar laddas när raden syns (`lazyRowThumbs`,
  IntersectionObserver, en i taget): telefonens tumnagel, annars originalet upp till 8 MB, annars en bildruta ur
  en video upp till 64 MB (`videoFrame`). `suffixKeeper` slår upp sökvägarna på filnamnet först.
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
  `"signal attachment key"` → `modernKey`), eller i en egen nyckelfil med JSON-filen `android_keystore`
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
    och Härkomst; en query med noll rader sägs ut; en fil från disk väljer raden i rätt mapp; och HTML ur
    filnamn och databaser körs aldrig. Bara påhittade data. CI kör det i jobbet `apptest`, som inte stoppar
    releasen än.
  - **Facit** (`facit.js`, `facit/lab-android-nord.json`, `--facit`): Härkomst bedömer filerna i
    labbzippen och jämför T, Memories, förgrund, skärm, lås, kameran, Snapchats meddelande, Signals
    meddelanden och appversionerna med det som loggades på labbtelefonen (inom en sekund, Signal två).
    Labbzippen ligger inte i repot: sökvägen tas ur `FT_LAB_ZIP`, annars
    `~/Documents/Exampleextractions/Lab-Android-Nord-2026-11-02.zip`. Zippens storlek, mtime och ctime
    kontrolleras efteråt. Bara tider och versioner står i facit, inga namn eller nycklar.
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
- Härkomst: Android är provkört mot en labbtelefon (Android 13, LineageOS), inte mot en kommersiell extraktion; `usagestats` i XML (version 3, Android 9 och äldre) läses inte, batterihistoriken läses inte, ingen positionslogg läses på Android, bildfiler över 200 MB läses inte för EXIF, och inklistringen i Word är provkörd bara via urklippsstatus, inte i Word självt
- **Snapchat (beta):** typkoder och protobuf-tolkning är härledda ur en enda extraktion. Memories
  (`gallery.encrypteddb`) är SQLCipher och läses inte. Chattmedia är ofta krypterat på disk; nyckel och
  IV ligger i `message_content` men används inte. Flera Snapchat-konton i samma behållare: första
  träffen används. Android-Snapchat är kontrollerat mot en labbtelefon (Snapchat 14.30): typ 34
  (inspelning) sågs inte där, typ 5 utan attribution är bland annat media som laddas upp före ett skickat
  meddelande, och `memories.db` är okrypterat.
- **Signal (beta):** bara Android, kontrollerat mot Signal 8.10 och 8.33. Utan nyckel (ingen
  `secrets.json` och ingen inklistrad) läses Signal inte. En separat nyckelfil (`android_keystore`) läses
  inte automatiskt (formatet för Signal är inte sett). Signals logg sparas bara några dagar. En bild som redigerats i
  Signal har den redigerade versionens summa som `data_hash_start`, så originalet kan inte kopplas.
  Signal på iOS (K12345-26 har `grdb/signal.sqlite`, nyckeln i nyckelringen) läses inte.
