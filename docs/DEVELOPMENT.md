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
Releasetexten kommer från `.github/release-notes.md`, men releasen får bara raden om commit, sin egen versions
avsnitt (`## Nytt i X.Y`) och nedladdningen sist i filen (`scripts/release-notes.js`). Förut fick varje release hela
historiken, och filerna hamnade under tiotusentals tecken text. Saknas avsnittet för versionen stoppar bygget: skriv
det innan versionen höjs. Releaserna till och med 1.54 är kortade på samma sätt, med sin egen nedladdningstext kvar.
En release som redan är publicerad rörs inte: en push utan ny version bygger inget.
Ett snabel-a följt av ett namn i releasetexten läser GitHub som ett konto, som får ett meddelande och visas som
medverkande i releasen. 1.57 fick ett främmande konto så, av WhatsApps id `@lid`. Sätt sådant inom kodtecken:
`scripts/release-notes.test.js` stoppar det annars. Skriv det så i commit-meddelanden också: dem läser inget test.
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

En textfil kan också vara en databas i Queries: katalogens databas har `convert`, och
`tools/db-queries/text-logs.js` (`QueryTextLogs.toSqlite`) tolkar filen och lägger raderna i en
SQLite-databas i minnet innan queryn körs. Summorna i spårbarheten gäller filen som den står i
extraktionen. Än så länge finns en: `queries/android/samsung/` med `eRR.p` som tabellen `err`
(`convert: "err-p"`), tolkad med samma `parseErr` som Härkomst. Kolumnerna: `rad` (radnumret i
filen), `tid` (som i filen, med zon), `unix_ms`, `utc`, `zon`, `vad`, `kod`, `orsak`, `orsak_i_ord`,
`krasch`, `fel_klocka` och `text` (raden). En eRR.p från disk känns igen på `LOGM` först i filen
(`DbIdentify.kindOf` ger `text`) och på namnet. Härkomsts query `err-p` har samma tabell och
`unix_ms` som tidskolumn, så en rad ur eRR.p i Härkomst öppnar Queries med raden markerad.

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
- Raden högst upp (`#context-bar` i `Toolbox.html`) visas i Härkomst, Queries, Chattar och EXIF & karta
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

#### Databaserna läses en gång (`tools/_shared/db-share.js`)

Varje verktyg är en egen ram med eget minne. Förut läste, kontrollerade, hashade och dekrypterade därför Chattar,
Härkomst och Queries samma databas var för sig. Sedan 1.57 (2026-11-10) delar de på läsningen:

- `ExtractionCore.loadDatabase` med `share: { file }` frågar huvudfönstret först. Har ett annat verktyg databasen får
  frågaren en kopia av avbilden i minnet, med uppgifterna från den läsningen: CRC32, SHA-256, dekrypteringens siffror,
  och när och av vilket verktyg den lästes. Läser ett annat verktyg just in den väntar frågaren på det. Annars läser
  frågaren själv och säger till efteråt. Queries går samma väg för en databas ur extraktionen (`readEntries` i `run.js`).
  En databas från disk och en textfil som görs om (`convert`) läses som förut.
- Huvudfönstret (`DbShare.registry` i `src/script.js`) håller bara reda på vem som har vad och skickar vidare. Inga byte
  stannar där. Verktygen (`DbShare.client`) håller avbilden med en svag referens (`WeakRef`), så delningen hindrar inte
  att minnet lämnas tillbaka när databasen stängs. Meddelandena står överst i `db-share.js`.
- Delningens nyckel (`keyOf`) är filens namn, storlek och ändringstid, posternas namn, plats, storlek och CRC32, och för
  en krypterad databas profilen med en SHA-256 över nyckeln (`cipherTag`). Nyckeln själv skickas aldrig. Ett verktyg med
  en annan nyckel, eller utan, får därför aldrig ett annat verktygs dekryptering.
- En avbild lämnas bara ut om dess längd och första 100 byte (SQLites huvud, med ändringsräknaren) är som när den
  lästes. Chattar och Härkomst öppnar avbilden med `PRAGMA query_only`, och Queries kör SQL som skriver mot en egen
  kopia (se Databaser över 1,5 GB). Avbilden som tas emot används bara om den är en okrypterad SQLite-fil med
  uppgifterna om läsningen (`usable`). Annars läser verktyget själv.
- Protokollet och spårbarheten säger att läsningen är delad (`sharedLine`): "Läst ur zippen av Chattar 2026-11-10
  12:00:00 UTC. Verktygen delar på läsningen: …". Härkomst visar raden också under Källor, som Läsning.
- Lägesraden kommer ur `ExtractionCore.stageText`: läser, räknar SHA-256, dekrypterar med procent, lägger på `-wal`,
  väntar på ett annat verktyg (med dess skede) eller hämtar en kopia.
- Härkomsts lägesrad ritas före det som går utan paus i en databas från 8 MB (`PAINT_BYTES`): Telegrams avkodning
  ("Avkodar Telegrams meddelanden i …") och frågorna efter läsningen ("Söker i …"). Förut stod raden kvar på
  "Dekrypterar signal.sqlite (Signal)… 99 %" medan frågorna gick och sidan stod still. En databas där en fråga tar över
  50 ms (`SLOW_QUERY_MS`) får raden ritad först också nästa gång, då med texten som källan har satt ("Läser Signals
  databas (beta)…"). `ZipRead.painted()` väntar på en riktig ritning (en bildruta och en paus, i ett dolt fönster bara
  pausen). Queries skriver "Kör queryn…" på samma sätt.
- Kommer inget svar inom 10 s (`ACK_MS`), eller ingen kopia inom 30 s (`GIVE_MS`), läser verktyget själv. Väntan på ett
  verktyg som läser in har ingen gräns. Därför säger det som läser alltid till (`sharedCore`): när det är klart, när
  läsningen går fel och när avbilden inte går att dela. En fil under 100 byte, som en tom databas, delas inte: varje
  verktyg läser den själv. Det sista rättades 2026-11-11, innan delningen var släppt: nästa verktyg väntade annars
  för alltid på en sådan fil. Laddas en ram om glömmer huvudfönstret vad den hade (`forget`). Ett verktyg som öppnas
  för sig, utan huvudfönster, läser som förut.
- Navet skickar valda nyckelfiler till ett verktyg en gång per val (`keysSent`). Förut skickades de varje gång verktyget
  visades, och Härkomst släppte då sin dekrypterade Signal-databas och läste och dekrypterade den igen.
- Mätt 2026-11-10 i Electron med en påhittad extraktion (Signal på iOS: 314 MB krypterad, 451 konversationer och
  600 000 meddelanden), med Chattar öppnat först:

  | | Förut | Nu |
  |---|---|---|
  | Första bedömningen i Härkomst | 3,8–4,0 s | 1,7 s |
  | Samma bedömning efter ett besök i Chattar, med nyckelfilen vald för hand | 3,4 s | 1,1 s |
  | Första queryn i Queries mot samma databas | 2,3–2,4 s | 0,2 s |

  Av de 1,7 sekunderna är 0,8 Härkomsts egna frågor mot databasen, och då står sidan still. Öppnas verktygen
  samtidigt läses och dekrypteras databasen en gång, vilket av dem som än frågar först (provat i tre ordningar).
- Tester: `db-share.test.js` (huvudfönstrets bokföring och verktygens del, med en klocka som testet vrider fram),
  `extraction-share.test.js` (läsningen genom delningen, med en krypterad databas ur `fixtures/sqlcipher-builder.js`)
  och röktestets del "Verktygen delar på läsningen".
- Provat mot labbet `iPhone - Signal_Whatsapp` 2026-11-11 (zippen på 32,6 GB med nyckelringen bredvid): Chattar läste
  WhatsApp, Signal, Telegram och Snapchat, och sedan bedömde Härkomst sex filer och Queries körde nio queryer mot
  samma databaser. Svaren var desamma som när Härkomst och Queries läste själva: 48 faktorer, 1 761 händelser,
  77 källor och 180 rader jämförda, och bara raden om vem som läste databasen skiljer. Fyra av varje fils tolv eller
  tretton källor kom från Chattar. Någon tidsvinst syns inte där, eftersom databaserna är små: första bedömningen
  tog 2,0 s på båda sätten. Kontrollen gjordes med skript utanför repot. Labbtesterna (`lab-ios.js`) har ingen del
  för delningen eller för Chattar.
- Kvar: verktygen delar en tråd, så medan ett verktyg läser, dekrypterar eller kör en fråga står de andra still. Varje
  verktyg har också sin egen kopia av avbilden i minnet. Tiderna ovan är bara mätta med påhittade data.

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
  `extraction-keys`, en gång per val (`keysSent`): med nya nycklar läser verktyget in sina krypterade databaser
  igen. Ett verktyg som valt en nyckelfil skickar den till navet på samma sätt. Det som hittas
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
  `facit/lab-tva-telefoner.json` är underlaget ur tvåtelefonslabbet 2026-11-11 (Samsungen och en iPhone, 75 steg):
  110 rader med stegets kod, telefon, tid och vilken kolumn eller fil tiden kommer ur, lästa utan programmets
  kod. Loggens tid står bredvid men är inte facit: loggen började två minuter in i labbet och 19 steg trycktes
  mer än 30 sekunder sent. Inget labbtest läser filen än.

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

### Chattar (`tools/chats/`)

- Visar konversationerna i chattapparnas databaser som i appen. Följer extraktionen som Härkomst och Queries
  (`CONTEXT_TOOLS` i `src/script.js`), hittar databaserna med `ExtractionCore.open` och läser dem som Härkomst:
  nyckeln via `AppSecrets`, Telegrams format via `TelegramPostbox`. Ingen SQL finns i verktyget.
- **Chattrollerna** är dolda queryer i katalogerna, som Härkomsts roller: `chat-threads`, `chat-members`,
  `chat-messages` och `chat-attachments`. Databasen får `chatApp` (appens namn). Fälten (de första är obligatoriska):
  - `chat-threads` (inga params): `id`, `name`, `kind` (`person`, `group`, `status`, `channel`, `self`, `other`);
    gärna `address`, `messages`, `first`, `last`, `archived`, `removed`.
  - `chat-members` (inga params): `threadId`, `id`, `name`; gärna `address`, `admin`, `active`, `isMe`.
  - `chat-messages` (`threadId` inom citattecken i SQL:en): `id`, `threadId`, `fromMe`, `text`, `kind` (`text`,
    `image`, `video`, `audio`, `voice`, `file`, `contact`, `location`, `sticker`, `gif`, `call`, `system`,
    `deleted`, `poll`, `other`); gärna `senderId`, `senderName`, `kindLabel`, `viewOnce`, `deleted`, `edited`,
    `expiresIn`, `device`, `replyTo`, `replyText`. Tiderna listas i `times` (`key`, `label` och `note`, som nämner
    kolumnen), `sortTime` ordnar bubblorna, och `details` är fler råa fält i klockans ruta.
  - `chat-names` (valfri, i en annan databas i samma app, inga params): `id` och `name` eller en kolumn som
    `nameFrom` säger hur den läses (`snapchat-flatbuffer`: `ProvenanceSnapchat.friendNames`). Namnen läggs på
    deltagare och avsändare som bara har ett id. `nameFromMembers` på `chat-threads` ger konversationen
    deltagarnas namn; med värdet `'person'` bara de enskilda chattarna, så att en grupp behåller sitt eget namn
    (WhatsApp på Android). `textFrom` på `chat-messages` säger att texten avkodas ur fältet `content` (`snapchat`).
  - `chat-attachments` (valfri, `threadId`): `messageId`, `path` (relativ `fileRoot`, som räknas från databasens mapp:
    `.` eller `..` uppåt); gärna `thumbPath`, `mime`, `size`, `duration`, `sha256` (hex) eller `sha256b64`,
    `name`, `title`, `cardName`, `card`, `lat`, `lon`, `uploaded`.
- **Kontraktet testas** i `catalogs.test.js`.
  - Varje databas med chattroller ska ha alla fyra roller med fälten ovan, tider med förklaring och en synlig
    meddelande-query med `chat: { thread, message }`. Den anger kolumnerna med chattens och meddelandets id.
  - Varje chattroll är en enda sats, eftersom meddelandena och bilagorna läses med en förberedd sats i omgångar.
  - WhatsApps roller körs mot labbtelefonernas scheman (`fixtures/chat-schemas.json`, iOS och Android), så en ändrad
    kolumn stoppas där. Android-rollerna och de synliga queryerna körs också mot påhittade rader i det schemat.
  - De synliga queryerna kan ändras fritt.
  - En ny app får chattvyn genom att lägga till rollerna i sin katalog och sin katalog i `index.html`.
- **Queries → Chattar**: en query med `chat` får knappen Chatt på varje rad när databasen kommer ur en extraktion.
  Knappen skickar `{ type: 'open-chat', path, db, thread, message, zipName }`, och huvudfönstret lämnar över till
  Chattar, som öppnar chatten och blinkar meddelandet. `ExtractionCore.zipSource` har därför `path`, postens
  fulla namn. **Chattar → Queries**: klockans ruta har Visa raden i Queries. Den skickar `open-query` med rollens
  SQL och meddelandets tid och id, som från Härkomst.
- **Listan** (1.57, 2026-11-10): en extraktion kan ha hundratals konversationer i flera appar, och då räcker det inte
  att rulla.
  - Över listan står knappar för app och för slag (Enskilda, Grupper, Status, Kanaler, Till mig själv, Andra), var och
    en med antalet som valet skulle visa. Där finns också ordningen (Senaste först, Flest meddelanden, Namn A–Ö) och
    Dölj tomma. Raden under säger till exempel "Visar 380 av 454 konversationer" och har Visa alla. Varje databas kan
    fällas ihop. Urvalet räknas i `ChatCore.listView`, utan sidan, och testas i Node.
  - Sökrutan letar i konversationens namn och adress och i deltagarnas (`listIndex`, `listMatch`). Varje ord ska
    finnas, i konversationen eller hos en deltagare. En träff genom en deltagare säger vem: "Deltagare:
    +46700000125".
  - Ett nummer jämförs som siffror, hur det än är skrivet: "070-000 01 25" hittar +46700000125. Fyra siffror eller
    fler hittas var som helst i numret, färre bara i dess början. Ett maskin-id (UUID eller lång hexsträng) hittas
    bara från sin början och med minst åtta tecken, och domänen i en JID söks aldrig. Annars träffar "12" och "net"
    nästan varje konversation.
  - Raderna ritas 200 åt gången per databas (`LIST_STEP`). Nästa omgång ritas när listans slut närmar sig
    (`IntersectionObserver`) eller med Visa fler. Den öppna konversationen ritas alltid.
  - Mätt 2026-11-10 med 454 påhittade konversationer i tre databaser (380 grupper i Signal): listan ritade förut
    alla 454 rader (2 276 element, 22 830 px) och ritar nu 203 först (1 031 element, 9 910 px). Ett tecken i
    sökrutan räknar om listan och sidans layout på 1–6 ms. Listan är inte provad med en riktig extraktion med
    hundratals konversationer.
  - Sökningen letar inte i meddelandenas text, och ett nummer hittas bara om databasen har det för konversationen
    eller deltagaren. Det säger sökrutans hjälptext och raden som visas när inget matchar: ingen träff på ett
    nummer betyder inte att numret saknas i appen.
    - WhatsApp på iOS: en konversation vars adress är ett id med `@lid` har inget nummer i `ChatStorage.sqlite`, i
      labbet varken i raden eller hos deltagaren. Den hittas på namnet och inte på numret. I labbet står numret i
      WhatsApps `LID.sqlite` i samma appgrupp, som inte läses än: tabellen `ZWAZACCOUNT` har adressen med `@lid` i
      `ZIDENTIFIER` och numret i `ZPHONENUMBER` (två rader, varav en är konversationens), och
      `ZWAPHONENUMBERLIDPAIR` (`ZLID`, `ZPHONENUMBER`) är tom. Det är sett 2026-11-11 i en enda extraktion, och
      bara tabellernas namn, kolumner och antal rader är lästa. Ingen roll är skriven för databasen.
    - Signal på iOS: se adressen under Signal på iOS nedan.
  - Provat mot labbet `iPhone - Signal_Whatsapp` 2026-11-11: tio konversationer i fyra appar (sju enskilda, två
    status och en annan, ingen grupp). Antalen vid knapparna stämde med raderna som visades. De två telefonnummer
    som listan har hittades skrivna i sin helhet, som de sista sju siffrorna med ett mellanrum och nationellt med
    bindestreck, med en rad kvar varje gång. En träff genom en deltagare i en grupp är bara provad med påhittade
    data.
- **Bilagorna** letas upp i extraktionen när konversationen öppnas och läses som blob-URL:er när de syns
  (`IntersectionObserver`). En fil över 80 MB läses först efter ett klick. Fler än 300 lästa filer släpps när de
  inte längre finns i sidan, så att minnet inte växer med chatten.
- **Stora chattar** (mätt 2026-11-09 med påhittade WhatsApp-chattar i Electron):
  - Före: 100 000 meddelanden tog 5,0 s att rita med sidan stilla, 1,1 miljoner element och 141 MB. Ett byte av zon ritade om
    allt på 4,8 s. 300 000 tog 15,8 s och 468 MB. Läsningen ur databasen var aldrig problemet: SQL och modell tog 1,5 s för
    300 000.
  - Konversationen läses i omgångar (`ChatCore.readRows`: en förberedd sats, en paus för sidan var 40:e ms) och visas
    först när den är klar. Rutan över chatten (`Job`) visar stegen, raderna hittills, tiden och Avbryt. Ett avbrott
    lämnar det som visades. Rutan visas efter 250 ms, så att små chattar inte blinkar.
  - Bubblorna ritas i block om 250 meddelanden. Ett nytt block ritas när kanten är närmare än 1 500 px, och block långt
    bort tas bort, så att sidan har högst 1 500 meddelanden. Läget hålls när ett block läggs till eller tas bort ovanför.
    Webbläsarens scroll anchoring får vara på, för bilder som laddas ovanför; `keepPlace` rättar bara när läget inte
    redan stämmer. Datumen är `sticky` och anger då sin fastsatta plats, så hopp räknas från meddelandet, inte datumet.
  - Sök letar i text, bildtext, filnamn och kontaktkort i hela konversationen (`searchIndex`, `findAll`), märker
    träffarna i sidan och börjar vid det som syns. Gå till datum tar det tidigaste meddelandet från dagens början i
    vald zon (`atOrAfter`, som inte litar på ordningen). Första och Senaste (och Home och End) ritar om runt dem.
  - Modellen sparar inte raden en gång till (`mapRows` med `{ raw: false }`): tiderna har sina råa värden.
  - Efter: 300 000 meddelanden öppnas på 1,4 s med förlopp, med 5 700 element och 51 MB. Ett block tar 66 ms, zonen
    0,13 s, en sökning 0,13 s och Gå till datum 0,09 s. Avbryt tar 0,2 s.
  - När extraktionen öppnas visar listan varje databas direkt och fyller i den när den är läst. Raden överst säger
    vilken databas som läses och har Avbryt: resten lämnas olästa, med Läs in i listan. En rad från Queries väntar bara
    på sin egen databas.
  - Kvar: Telegrams avkodning och Signals dekryptering går i sidans tråd. En egen tråd (Web Worker) för sql.js, dekrypteringen
    och avkodningen skulle hjälpa Queries och Härkomst lika mycket och är inte gjord. Sedan 2026-11-10 görs läsningen och
    dekrypteringen i alla fall bara en gång för de tre verktygen (se Databaserna läses en gång).
- **Tider** visas i datorns zon eller i UTC, med zonen utskriven. Klockans ruta visar varje tid med kolumn, rått värde och
  UTC (`ChatCore.formatter`, `offsetText`; `parseLocal` läser tidsspannet i exporten, också över sommar- och vintertid).
- **Telefonvyn** (1.57, 2026-11-10): Lista och Telefon över chatten byter utseende. Telefon ställer samma bubblor i
  en ram med en telefons bredd (25,9 em, 414 px vid 16 px text), med konversationens namn i ramens huvud.
  - Vyn är en rekonstruktion ur databasen och ska inte kunna tas för en skärmbild. Därför ritas ingen klocka,
    mottagning eller batterinivå, och inga modellnamn eller appars egna bilder används. Där appen har sin skrivrad
    står "Rekonstruktion ur databasen – inte en skärmbild" (`PHONE_LABEL`). Telefonens textstorlek, tema och
    appversion finns inte i databasen, så radbrytningar och färger kan ha sett annorlunda ut i telefonen. Det säger
    knappens text och exportens ingress.
  - Ramen följer plattformen (`ChatExport.phoneFrame`): en avlång urtagning för iOS, ett runt hål för Android och
    ingen för en okänd plattform. Bredden är densamma för alla: databasen säger inte vilken modell telefonen är.
    Bubblornas färger är samma som i listvyn: verktygets egna per app, inte lästa ur telefonen. På skärmen följer
    vyn verktygets tema.
  - Bytet håller platsen (`setLook`, `anchor`): stod chatten vid slutet står den kvar där, annars står det översta
    meddelandet kvar. Skär kanten meddelandet skärs det på samma ställe i sin nya höjd (`cut`): med överkanten på
    samma avstånd som förut hamnar ett meddelande som blir kortare i det andra utseendet helt ovanför kanten. Sök,
    klockans ruta, Välj meddelanden och blocken fungerar som i listvyn. Valet gäller tills verktyget laddas om och
    sparas inte.
  - Exporten har samma val (Utseende i rutan, med det som visas förvalt) och är alltid ljus. Bubblorna står i en
    remsa (`.strip` > `.phone`) med ett nummer utanför ramen, som är raden i spårbarhetstabellen. Tabellen är
    densamma som i listan.
  - I utskriften delas remsan i två spalter per A4-sida. Ramen är en `border-image` (en SVG ur `frameImage`) med
    `box-decoration-break: clone`: en kant ritas om i varje spalt och på varje sida, vilket en bakgrundsbild inte
    gör, och `position: sticky` fungerar inte i utskrift. Märkningen står därför i ramens fot i varje del.
    Sidfoten på varje sida (`@page { @bottom-center }`) kräver en Chromium-baserad webbläsare, som appen och Edge.
    Utskrift i Firefox och Safari är inte provad.
  - Provad med påhittade chattar i Electron och i html-versionen. Mot labbet `iPhone - Signal_Whatsapp` 2026-11-11
    visade vyn alla meddelanden i en chatt per app (12 i WhatsApp, 16 i Signal, 8 i Telegram och 9 i Snapchat) med
    märkningen i ramen, och Lista gick tillbaka. Exporten och utskriften i telefonvyn är bara provade med påhittade
    chattar.
- **Export** (`chat-export.js`): hela konversationen, valda meddelanden eller ett tidsspann.
  - Formatet är en fristående HTML-fil, med bilder upp till 25 MB per bild inbäddade, eller utskrift via en dold ram
    (spara som PDF i utskriftsdialogen).
  - Överst står källan. Sist kommer en spårbarhetstabell med varje meddelandes id, alla tider med kolumn och rått
    värde, och bilagornas sökväg och SHA-256.
  - Filen byggs i delar (`ChatExport.parts`, 1 000 meddelanden åt gången) med förlopp och Avbryt, och sparas som en Blob
    av delarna, så att en stor chatt aldrig blir en enda text. 300 000 meddelanden blev 148 MB på 7,9 s.
  - `ChatExport.estimate` säger i förväg ungefär hur stor filen och utskriften blir, för utseendet som är valt. Den är
    kalibrerad mot exporter utskrivna till PDF på A4 i Electron (2026-11-09 och 2026-11-10, 15 fall), inom 10 % utan
    bilder och 15 % med. Över 20 000 meddelanden eller 200 MB varnar Spara HTML, och över 300 sidor varnar
    utskriften. Ett andra klick bygger ändå.
  - Sidorna i listan: en elftedels sida per bubbla, en sida per 4 300 tecken, en sextiondel per tid i spårbarheten och
    en dryg halv per bild (1/1,9; förut 1/2,4, som räknade upp till 23 % för lågt för stående bilder i full
    storlek). I telefonvyn: en artondel per bubbla, en sida per 3 700 tecken, en sextiofemtedel per tid och en
    åttondel per bild. Den långa testchatten på 3 000 meddelanden blir 407 sidor som lista och 309 som telefon.
- **WhatsApp på iOS** är kontrollerat mot labbet `iPhone - Signal_Whatsapp` (2026-11-09).
  - Slaget kommer ur JID:ens domän: `@g.us` är grupp, `@lid` och `@s.whatsapp.net` person, `@status` och
    `@broadcast` status, `@newsletter` kanal.
  - Kvittenserna i `ZWAMESSAGEINFO.ZRECEIPTINFO` hade inga tider i labbet, så läst och levererat visas inte.
  - `ZMESSAGESTATUS` visas som rått värde.
  - En mediepost utan fil, storlek, adress, kontaktkort eller plats tas inte med. I labbet hade ett textmeddelande
    och typ 59 sådana.
- **WhatsApp på Android** (beta) är kontrollerat mot Samsungen i tvåtelefonslabbet 2026-11-11
  (`Exampleextractions/Android/EXTRACTION_FFS.zip`: Android 16, WhatsApp 2.26.43). Katalogen är
  `queries/android/whatsapp/`, med två databaser i `data/data/com.whatsapp/databases/`, båda okrypterade där.
  - `msgstore.db` är meddelandedatabasen: `message`, `chat`, `jid`, `message_media`, `receipt_user` och
    `message_revoked`. `wa.db` är kontaktlistan: `wa_contacts` har namnet till varje JID, och Chattar läser den som
    `chat-names`.
  - En enskild chatt hör till motpartens id med `@lid`. `jid_map` kopplar det till numrets JID
    (`…@s.whatsapp.net`), och det är numrets JID som rollerna lämnar som id, så att namnet ur `wa.db` passar. Ett
    konto som bara är känt som `@lid` har varken nummer eller namn.
  - Tiderna är Unix-millisekunder. Sedda i labbet, och jämförda med den andra telefonens tider där de fanns: `timestamp` (skrivet, och för
    ett mottaget meddelande avsändarens tid i hela sekunder), `received_timestamp` på mottagna meddelanden,
    `receipt_timestamp` och `read_timestamp` i `receipt_user`, och `revoke_timestamp` för ett meddelande som
    raderats för alla. `received_timestamp` på ett skickat meddelande visas för sig som en okänd tid: den stod på
    skickade mediefiler, upp till två sekunder efter att meddelandet skrevs.
  - `file_length` och `file_hash` (SHA-256 i base64) stämde med de fem mediefilerna i zippen, räknat utan appens
    kod. `file_size` gjorde det inte för röstmeddelandet och används inte. Filerna ligger under
    `data/media/0/Android/media/com.whatsapp/WhatsApp/`, fyra mappar upp från databasen (`fileRoot`).
  - Inte kontrollerat, och sagt så i katalogens texter: typerna för kontaktkort, plats, samtal, gif, klistermärke
    och engångsvisning, svar, redigeringar, uppspelat röstmeddelande, och `display_name` som namnet ur telefonens
    kontakter (labbtelefonen hade inga sparade kontakter). WhatsApp Business (`com.whatsapp.w4b`) letas inte upp.
  - En dold chatt utan meddelanden låg under telefonens eget `@lid`. Att det är telefonens eget står i
    `shared_prefs/com.whatsapp_preferences_light.xml` (`self_lid`) och inte i databasen, så Chattar utelämnar
    dolda chattar utan meddelanden och queryn Chattar visar dem med `dold`.
  - Båda databaserna hade en `-wal` med rader som inte fanns i huvudfilen (ett meddelande, ett kvitto och en
    kontakt). Appen läser den med databasen. En egen kontroll
    med `sqlite3` ska öppna en kopia med `-wal` bredvid, och inte med `immutable=1`, som hoppar över den utan att
    säga något.
  - Härkomst läser `msgstore.db` och `wa.db` genom katalogens dolda roller `media`, `messages`, `coverage` och
    `names`. Androiddelen av `whatsapp.js` (`matchAndroid`, `buildAndroid`) kopplar filen till ett meddelande på
    tre sätt, och faktorn **WhatsApp** säger vilket (`factorWhatsAppAndroid` i `timeline-core.js`):
    - filens SHA-256 är `file_hash`: filen är den som skickades eller togs emot;
    - filens SHA-256 är `original_file_hash`: filen är originalet till det som skickades. I labbet stod den bara på
      bilden som togs med WhatsApps kamera (originalet `WhatsApp Images/IMG-…-WA0000.jpeg`, den skickade kopian
      under `Sent/`). En bild som valts ur galleriet är inte kontrollerad;
    - filens sökväg slutar på `/WhatsApp/` och radens `file_path`: filen är WhatsApps egen, även om summan skiljer,
      och det sägs då.
  - WhatsApps filer står i MediaStore med `owner_package_name` `com.whatsapp`, oftast utan `datetaken`, så T är
    `date_added`. I labbet var `date_added` på den mottagna bilden samma sekund som `received_timestamp`. Typen
    blir "WhatsApp-media", kameran frågas inte, och meddelandets tid får ett eget fönster när det ligger utanför T:s.
  - En kamerabild i `DCIM/Camera` som skickats som dokument hittas på summan och ger en upplysning: att den
    skickades säger inget om hur den skapades. En fil bland kamerabilderna som bara togs emot är en motsägelse.
  - Hashsökningen: en SHA-256 som inte finns i zippen söks i `message_media` (båda kolumnerna). I labbet är det
    videon som aldrig hämtades (`file_path` tom, `transferred` 0).
  - En fil som togs emot i en chattapp kräver varken appen i förgrunden eller tänd skärm: för chattappens egen
    kopia av en mottagen fil är en släckt skärm eller en annan app i förgrunden en upplysning, inte en
    motsägelse (`BACKGROUND_NOTE`). I labbet sparades den mottagna bilden med släckt skärm och utan app i
    förgrunden enligt `usagestats`. Regeln gäller alla chattappar och båda systemen; bara WhatsApp på Android är
    kontrollerat.
  - Inte kontrollerat: `original_file_hash` för en bild ur galleriet, WhatsApp Business, äldre mapplayout
    (`WhatsApp/Media/` direkt under lagringen) och medietyper som inte fanns i labbet.
- **Telegram på Android** (beta) är kontrollerat mot samma Samsung i tvåtelefonslabbet 2026-11-11
  (`Exampleextractions/Android/EXTRACTION_FFS.zip`: Android 16, Telegram med versionskod 73031 enligt
  `data/system/packages.list`). Katalogen är `queries/android/telegram/`, med en databas:
  `data/data/org.telegram.messenger/files/cache4.db`, okrypterad där.
  - `cache4.db` är Telegrams lokala databas: `messages_v2` (en rad per meddelande), `dialogs` (en rad per chatt),
    `users`, `chats`, `media_v4` och `contacts`. `uid` i `messages_v2` är chattens id: positivt för en person,
    negativt för en grupp eller kanal.
  - Kolumnerna säger chatt, tid (`date`, Unix-sekunder), riktning (`out`) och läst (`read_state`). Text och avsändare
    står bara i blobben `data`, i Telegrams eget format. Katalogen läser den med ren SQL (`substr` och `hex`), utan
    avkodare i JavaScript, och bara för de konstruktorer som sågs i labbet:
    - meddelande `0x7600b9d3`: konstruktor, flaggor, flaggor, id, avsändaren när flaggans bit 8 är satt (i labbet
      på de skickade och på ett av tre mottagna i den enskilda chatten), chatten, tiden och sedan texten som en sträng med längden först.
      Queryn letar upp `date` i blobben på en jämn fyrbytesgräns och läser texten efter den, så fält mellan chatten
      och tiden stör inte.
    - tjänstemeddelande `0x7a800e0a` (gruppen skapades): riktning "tjänst", ingen text.
    - En annan konstruktor ger raden med chatt, tid och riktning men utan text, och typen "okänd konstruktor …".
      Hittas inte tiden i blobben står "texten kunde inte läsas". Ingen text gissas.
    - Den avancerade queryn "Kontroll: meddelandets blob" visar konstruktorn, var tiden hittades, textens längdbyte
      och de första 80 byten, så att läsningen kan kontrolleras för hand.
  - I labbet: sex rader, fem meddelanden med text och ett tjänstemeddelande. Texterna var labbets stegkoder, och
    `date` var på sekunden samma tid som den andra telefonens Telegram hade för alla sex.
  - Namnen: `users.name` och `chats.name` är gemener för sökning (`namn;;;användarnamn`). Namnet som det skrivs
    läses ur blobben (användare `0xb1b8cc83`, chatt `0x41cbf256`) och används bara när det är lika långt som
    sökningens namn; annars visas gemenerna.
  - Medier: typen kommer ur `media_v4.type`. I labbet fanns en rad, typ 0, för en mottagen bild. Vilken fil som hör
    till meddelandet står i blobben och läses inte, så Chattar visar bilagan som en rad utan fil. Bilden låg under
    `data/media/0/Android/data/org.telegram.messenger/files/Telegram/Telegram Images/`.
  - Inte kontrollerat, och sagt så i katalogens texter: `read_state` (i labbet 3 i den lästa chatten och 2 på
    skickade rader i gruppen), `send_state` (bara 0 sågs), de andra typerna i `media_v4` (fil, röst, länk, musik,
    gif), texter över 253 byte (längden i tre byte), hemliga chattar (id över 2^62, visas som "hemlig chatt N"),
    mottagna meddelanden i en grupp (labbets grupp hade bara skickade rader), kanaler, svar, redigeringar och raderade meddelanden. Betydelserna där kommer ur Telegrams öppna källkod ur
    minnet, inte ur labbet.
  - Chattens id lämnas som text: ett id för en hemlig chatt ryms inte exakt i ett JavaScript-tal, och sql.js ger
    heltal som tal.
  - Databasen hade en `-wal` på 4,5 MB. De sex tabellerna hade lika många rader med och utan den. Samma regel som
    för WhatsApp gäller för en egen kontroll med `sqlite3`.
  - Fler konton i samma app ligger under `files/account1/` till `account3/` med var sin `cache4.db`. De letas inte
    upp. Andra paket än `org.telegram.messenger` (till exempel butiksvarianter) letas inte heller upp.
  - Härkomst läser `cache4.db` genom de dolda rollerna `messages`, `photo` och `coverage`. Androiddelen av
    `telegram.js` kopplar bara Telegrams egen bildfil till sitt meddelande (`factorTelegramAndroid`):
    - filen heter `<tal>_<kod>.jpg` under `org.telegram.messenger/`. Talet med omvänt tecken är bildens id, och koden
      är teckenkoden för storlekens bokstav (121 är `y`). Så var det för labbets enda bild; regeln är inte prövad
      på fler;
    - rollen `photo` letar upp id:t (åtta byte, lägsta först) i `messages_v2.data` med `instr`, och `parsePhoto`
      läser bilden från konstruktorn `0xfb197a65`: id och storlekar (`photoSize`, `photoSizeProgressive`,
      `photoStrippedSize`, `photoCachedSize`, `photoPathSize`). En träff räknas bara när id:t står på en jämn
      fyrbytesgräns direkt efter konstruktorn och flaggorna; andra träffar redovisas som olästa;
    - storleken med filnamnets bokstav jämförs med filens storlek. I labbet var de lika (sista steget i
      `photoSizeProgressive`).
  - Filen står inte i MediaStore, så den bedöms som en fil utanför bildbiblioteket, och T är tiden inuti filen
    eller zippens ändringstid. Meddelandets tid får ett eget fönster när den ligger utanför T:s.
  - En fil som inte är Telegrams egen bildfil kopplas inte: Telegram kodar om bilder som skickas, och ingen summa
    står i databasen. Faktorn säger då "Ingen koppling" och att det inte betyder att filen aldrig skickades där.
    Hashsökningen har av samma skäl inget att söka i.
  - Inte kontrollerat: skickade bilder, videor, dokument och filer som sparats till galleriet, kanaler, och andra
    versioners konstruktorer.
- **Bilagor som appen krypterar** dekrypteras i `chat-media.js` efter rollens `decrypt`. Innehållets SHA-256 jämförs
  med databasens och syns under filen och i klockans ruta.
  - `signal-ios`: filen är IV (16 byte), AES-256-CBC och HMAC-SHA256 (32 byte) över IV och chiffertext, med bilagans
    `encryptionKey` (64 byte: AES, sedan HMAC). Klartexten kapas till `unencryptedByteCount`. Kontrollerat mot
    labbets elva filer 2026-11-09: HMAC och SHA-256 stämmer för alla.
  - `signal-android`: AES-256-CTR med noll-IV och nyckeln HMAC-SHA256(`modernKey`, `data_random`), samma kod som i
    Härkomst (`SqlCipher.hmac`, `ctr`).
- **Signal på iOS** är kontrollerat mot labbet 2026-11-09.
  - Labbets tråd har bara skickade meddelanden, samtal och ett infomeddelande. Mottagna meddelanden, grupper och
    `model_TSGroupMember` är bara prövade med påhittade rader på labbschemat.
  - Bubblorna ordnas på `receivedAtTimestamp` (telefonens klocka). Klockans ruta har också avsändarens klocka,
    serverns tid och, för ett mottaget meddelande med försvinnande tid, när det öppnades (`expireStartedAt`).
  - Enheten för skickade meddelanden kommer ur `wasNotCreatedLocally` och står i klockans muspekartext och ruta.
    `deprecated_sourceDeviceId` visas som rått värde, utan tolkning.
  - `chat-threads` räknar antal och första och senaste tid i en enda genomläsning av `model_TSInteraction`
    (`NOT INDEXED`, `GROUP BY uniqueThreadId`). Inget index har både tråden och tiden, så en fråga per tråd fick slå
    upp varje meddelande för sig. Med 600 000 påhittade meddelanden i 451 trådar: 991 ms förut, 310 ms nu
    (2026-11-10).
  - Adressen (`thread_address`, `member_address`) är numret när databasen har det (1.57, 2026-11-11). Har trådens
    eller gruppmedlemmens rad bara ACI hämtas numret ur `model_SignalRecipient` på `recipientUUID`, och finns det
    inte där står ACI kvar. Android-katalogen gör likadant (`COALESCE(tr.e164, tr.username, tr.aci)`).
    - Förut var adressen ACI så fort raden saknade nummer. I labbet gäller det båda trådarna med en person: ingen
      har `contactPhoneNumber`. Listans sökning hittade då inte en namngiven kontakt på numret, och inte en grupp
      genom en deltagares nummer.
    - Adressen används bara för visning och sökning (under namnet, i deltagarlistan och i exporten), aldrig för
      att koppla meddelanden. Där 1.56 visade ACI under namnet står nu numret. Deltagarens `id` är fortfarande
      ACI och hittas i listan från sin början, och ACI står i queryn Kontakter.
    - I labbet har en av Signals två kontakter nummer i `model_SignalRecipient`, och den fick numret som adress.
      Den andra, som har ett namn, har inget nummer i databasen och hittas bara på namnet. Att en namngiven
      kontakt hittas på numret, och en grupp genom en deltagares nummer, är alltså bara visat med påhittade rader
      (`catalogs.test.js`, som föll med de gamla uttrycken).
    - Uppslaget har index i labbets databas (`index_signal_recipients_on_recipientUUID`) och kostar ingen mätbar
      tid: med påhittade data tog `chat-threads` 297 ms med och utan, och `chat-members` 38 ms mot 37 för
      12 505 rader (2026-11-11).
  - **Rättat i 1.57 (2026-11-10): fel namn på kontakter.** Queryn Kontakter (`recipients`) och rollen `role-recipients`
    använde aliaset `sr` också inne i två av sina delfrågor, så jämförelsen `sr.recipientUUID = sr.recipientUUID`
    var alltid sann och delfrågan gav samma rad för varje kontakt. Felet kom med rollerna i 1.41 och fanns till och
    med 1.56.
    - Med minst ett smeknamn i `NicknameRecord` fick varje kontakt det smeknamnet, också telefonens ägare.
    - Utan smeknamn fick en kontakt utan eget namn (inget i `model_SignalAccount` och inget profilnamn) numret
      från den första raden med `recipientUUID` i `model_SignalRecipient`, i stället för sitt eget nummer eller id.
      I testets databas är det telefonens ägare.
    - Det syntes där Härkomst namnger avsändaren av ett mottaget meddelande (`counterpartIos`: händelserna i
      tidslinjen, kopplingen till en bilaga och hashsökningens text) och i kolumnen `namn` i Kontakter. Kolumnerna
      `telefon` och `aci` var rätt, och meddelandenas och trådarnas egna queryer hade inte felet.
    - Det syntes inte i labbet: dess tråd har bara skickade meddelanden, och rollen namnger bara avsändaren av ett
      mottaget. Queryn Kontakter ger också samma namn på labbets två kontakter som queryn från 1.56
      (2026-11-11). Felet är alltså bara visat med påhittade kontakter.
    - `catalogs.test.js` har nu kontakter med var sitt slags namn, och testet föll före rättningen. Det
      kontrollerar också att ingen query i katalogen jämför en kolumn med sig själv.
- **Signal på Android** har roller ur samma tabeller och tolkningar som de synliga queryerna, som är kontrollerade
  mot en labbtelefon och en verklig extraktion. Rollerna är inte körda mot en riktig databas här: Nord-labbets zip
  finns inte på datorn, och nyckeln till A33:ans Signal saknas. I en grupp listas de som skrivit i gruppen enligt
  meddelandena, inte gruppens medlemslista.
- **Telegram på iOS** är kontrollerat mot labbet 2026-11-09 med 8 meddelanden, 5 bilder och en video. Rollerna läser
  tabellerna som `postbox.js` avkodar i minnet.
  - Chattarna är de som har meddelanden i t7.
  - Varje meddelande får sin största resurs (`postbox/media/<resursens id>`) och den näst största som `thumbPath`.
    Saknas den största visar Chattar den mindre och säger det, också i exporten.
  - Meddelandets tid är tiden i nyckeln i t7, i hela sekunder.
- **Snapchat på iOS och Android** är kontrollerat mot labben `iPhone - tidsstämplar` (14 meddelanden i tre
  konversationer) och `Samsung A33 - Laboration` (2 meddelanden) 2026-11-09.
  - Texten står i `message_content` i fältet 4.4.2.1 på båda plattformarna.
  - Skickat från telefonen avgörs av att `sender_id` är `USERID` i `required_values`. `created_on_device` räcker
    inte: i labbet var ett eget meddelande 0.
  - Namnen kommer ur kontodatabasen (`snapchatter.p` på iOS, `Friend` på Android).
  - Snapar och andra medier visas som text. Filerna ligger i Snapchats cache och kopplas inte till chatten i den här
    versionen.

### Laboration (`tools/lab/`)

- Ett verktyg för den som gör en egen laboration: ett flöde av steg görs under **Förbered**, gås igenom med datorns
  klocka under **Genomför**, och blir en tabell till protokollet under **Tabell** (tid, enhet, åtgärd, kod,
  anmärkning). Verktyget läser ingen extraktion och följer inte med mellan verktygen. Ingenting lämnar datorn.
- **Kärnan** är `lab-core.js` (`LabCore`, utan DOM, testad i `lab-core.test.js`). Sidan (`script.js`) ritar och
  lyssnar, och räknar ingenting själv.
  - **Flödet**: `{ name, prefix, devices: [{ id, name }], groups, steps, next }`. Ett steg har `action` (ur
    `ACTIONS`, eller `custom` med egen text), `device` (ett id eller `ALL`, alla enheter), ibland `other`
    (motparten), `app`, `wait` (sekunder efter steget), `group` (gruppens id) och `block` (gruppens rubrik, som
    tabellen och äldre filer läser). Koden (`L01`, `L02` …) räknas ur platsen i flödet och sparas inte, så den
    följer med när steg flyttas. `{kod}` i en egen text byts mot stegets kod.
  - **Grupperna** (1.61): `{ id, title, app, a, b, template }`. Stegen ligger alltid i en grupp, och i flödet står de
    i gruppernas ordning (`tidy` gör ett flöde ur en äldre fil helt: en grupp per följd av steg med samma rubrik).
    `a` och `b` är de två enheter gruppens chattsteg går mellan. `updateGroup` ändrar rubriken, byter app i stegen
    som hade gruppens app, flyttar stegen från en enhet till en annan och vänder riktningen (`swap`). `copyGroup`
    gör en kopia direkt efter, `moveGroup` flyttar gruppen, och `moveStepTo(flow, id, groupId, pos)` lägger ett
    steg på en plats i en grupp. `outline` är grupperna med sina steg och sin väntan, som sidan ritar.
  - **Mallarna** är data, `BLOCKS`: klockorna i början och i slutet, text, medier, grupp, raderat meddelande och
    samtal (`kind: 'chat'`, en gång per vald app), kamera och skärmdump, en app i förgrunden, lås och avstängning,
    och tidszon. En mall är `{ id, label, desc, steps: [{ action, on, other, wait, do, done, press, app }] }`, där
    `on` säger vem som gör steget: `a` eller `b` (de två som chattar), `all` (alla enheter i ett steg) eller `each`
    (en gång per enhet). `insertTemplate(flow, mall, { a, b, app }, index)` gör en grupp av mallen, och
    `buildFlow({ name, prefix, devices, pair, apps, blocks })` ett helt flöde av flera. En ny mall är en post i
    `BLOCKS`, och en ny åtgärd en post i `ACTIONS` med texten att göra (`do`), när man trycker (`press`) och
    meningen i tabellen (`done`).
  - **Egna mallar** (1.61) har samma form. `templateFrom(flow, { group } | { step }, { id, label })` gör en mall av
    en grupp eller ett steg: enheterna blir roller (`a`, `b` …), och bara texter som skiljer sig från åtgärdens
    egna sparas. Mallen följer därför enheterna och appen som är valda när den läggs in. `mergeTemplates` lägger
    mallar utifrån till listan: samma innehåll läggs inte till igen, och ett upptaget id byts (`renamed`).
    `cleanTemplate` bygger om en mall utifrån fält för fält.
  - **Kontrollen** (`check`, 1.61) ger råd och hindrar ingenting: ett steg utan text, ett chattsteg utan motpart
    eller app, ett svar eller ett läst meddelande utan något skickat före, en enhet som startas utan att ha stängts
    av, flygplansläge och tidszon som återställs utan att ha ändrats, och en grupp utan steg. Svaret är
    `[{ step, group, code, text }]`.
  - **Körningen**: `{ started, off, zone, entries, notes, undone, waitUntil, waitStep }`. Ett tryck är
    `press(flow, run, clock, 'klar' | 'hoppad')` och gäller alltid nästa steg i ordningen. Klockan ges utifrån som
    `{ t, off }` (millisekunder och datorns minuter öster om UTC i det ögonblicket), så testerna beror inte på
    datorns zon och en rad behåller sin zon över ett byte av sommartid. Under en väntan tas inget tryck emot
    (`isWaiting`); `cutWait` avbryter den och skriver det i anmärkningen. `undo` flyttar det senaste trycket till
    `undone`, som räknas i tabellens uppgifter. `toggleApprox` märker tiden som ungefärlig (`ca` i tabellen).
    `addNote` ger en egen rad med tiden då anteckningen började skrivas.
  - **Tabellen**: `rows` ger raderna i den ordning de gjordes (ett överhoppat eller ogjort steg står som
    `inte utförd`), `facts` uppgifterna ovanför, `protocol` tabellen som HTML med inline-stilar (Word gör en tabell
    av den vid inklistring, och samma HTML skrivs ut) och som text med tabbar, och `toCsv` en fil med semikolon,
    BOM och en UTC-kolumn. Datumet står på varje rad bara när laborationen går över midnatt.
  - **Filen** (`toFile`/`fromFile`): JSON med `format: "forensics-toolbox-laboration"`, flödet och, om det finns,
    körningen. Samma fil är alltså både ett flöde att dela och en logg att öppna igen. `fromFile` städar varje fält
    som när det skrevs in och kastar det som inte hör till formatet. De egna mallar som flödets grupper kom ur
    följer med som `mallar`, och läggs under Mina mallar hos den som öppnar filen. Alla egna mallar sparas som en
    egen fil med `templatesToFile` (`format: "forensics-toolbox-laboration-mallar"`), och `Öppna` tar båda slagen.
- **Förbered är en byggare** (1.61). Till vänster ligger byggstenarna: mallarna, Mina mallar, Eget (eget steg, ny
  grupp, väntan) och åtgärderna som enskilda steg. Flödet till höger har en plats mellan varje steg och varje
  grupp. **Märket** (`state.mark`, `{ at }` mellan grupper eller `{ group, pos }` i en grupp) är platsen där nästa
  byggsten hamnar: plus sätter det, och utan märke är det flödets slut. Ett klick på en byggsten och ett släpp
  efter ett drag går genom samma `place(kind, id, plats)`. En mall blir alltid en egen grupp, ett steg hamnar i
  gruppen vid märket, och väntan läggs på steget före. Dragen är HTML5-drag (`startDrag`, `targetAt`, `onDrop`):
  en byggsten ur listan, ett steg (också till en annan grupp) och en hel grupp i rubriken. Allt som går att dra
  går också att göra med knappar (plus, pilarna, Ändra, minus), så tangentbordet räcker.
- **Ångra**: varje ändring av flödet går genom `change(fn)`, som först sparar flödet som text (högst 50 steg
  bakåt). `fn` som svarar `false` ändrade ingenting, och då sparas inget. Knappen Ångra och Ctrl/Cmd+Z (inte i
  ett textfält) tar tillbaka den senaste. Historiken töms när laborationen börjar och när en fil öppnas.
- **Det färdiga upplägget** (`#p-quick`, valen av appar och mallar som gör ett helt flöde) visas när flödet är
  tomt och bakom knappen `Färdigt upplägg`.
- **Allt ur flödet och loggen är text.** Sidan sätter det med `textContent`, och `protocol` och `checklist` går
  genom `esc`. Ett ord utan mellanslag som är längre än 20 tecken får brytas i tabellerna (`softParts`, `<wbr>`),
  annars blir tabellen bredare än papperet. Texten själv ändras inte, och CSV-filen och textvarianten får den hel.
- **Läget sparas** i `localStorage['ft-laboration']` efter varje ändring, som samma fil plus valen under Förbered,
  och läses vid start; en påbörjad laboration öppnas i Genomför. Går lagringen inte att skriva säger sidan det
  och ber om att loggen sparas som fil. De egna mallarna ligger för sig i `localStorage['ft-laboration-mallar']`,
  så att `Börja om` och ett nytt flöde inte rör dem. I appen ligger lagringen i användarens datamapp och inte i
  programmets mapp. HTML-utgåvan sparar per webbläsare och per mapp som sidan öppnas ur, så där är filen med
  mallar sättet att ta dem med sig.
- **Tangenterna** gäller bara i Genomför och inte i ett textfält: mellanslag (gjort), H (hoppa över), A (anteckning),
  T (tryckte för sent), backsteg (ångra), V (avbryt väntan) och Enter (starta). Medan anteckningen är öppen gäller
  de den. Före start är mellanslag ett övningstryck som inte sparas. När laborationen har börjat är Förbered låst;
  `Ny laboration med samma flöde` under Tabell tar bort körningen och låser upp.
- Electron har ingen `window.prompt`, så egna steg och anmärkningar skrivs i formulär i sidan. Utskriften går genom
  en dold ram (`#l-print`, `srcdoc`), så att bara tabellen skrivs ut.
- Inte prövat: utskriftsdialogen i appen och inklistring i Word. Kopieringen är prövad i Chrome med ett riktigt
  musklick (HTML och text i urklipp).

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

- **SSRM** (`com.sec.android.sdhms/ssrm_heating_N.log`, 20 filer på cirka 1000 rader som skrivs i tur och ordning): `[PKG] <paket>` är appen i förgrunden, `[SET] … [LCD] ON/OFF` skärmen, `[SET] … camera running :: true/false  client : <paket>` kameran med appen som använder den (i en längre session också var tionde sekund, med ` info : MODE=0; …` efter). `[VER] <bygge> START/SHUTDOWN` och `===== ABOVE LOGS ARE FROM LAST BOOTING =====` är omstarter. Tiden är lokal utan zon, i zonen när raden skrevs; `[RTC] a b  <UTC-text> <unixtid>` ger zonen. Utan telefonens zon gör två `[RTC]` som säger olika tiden mellan dem osäker. Med den (se Telefonens zon) räknas raden om med förskjutningen vid sin tid, när `[RTC]` närmast före och efter stämmer med zonen. Raderna från en start till första `[RTC]` (inom en minut) har dock den radens zon: skärmen tänds på dem, och i labbet hade zonen bytts under de 28 dagar telefonen låg låst. Ett uppehåll på mer än en timme är ett hål i loggen, mätt i UTC när telefonens zon är känd: vårens hopp från 01:59 till 03:00 är annars en timme. `START` kommer efter första upplåsningen, inte vid start, så telefonen kan ha varit igång under ett hål. Filerna täcker månader på en telefon som mest ligger still, kanske en vecka på en telefon i daglig användning. Det är en uppskattning ur mätt radtakt: cirka 470 rader i timmen vid användning (245 rader på 31 minuter i labbet) och cirka 75 i timmen när telefonen ligger still, av 20 000 rader.
- **Batterihistoriken** (`/data/log/batterystats/newbatterystatsYYMMDDHHMMSS`, 40 filer, upp till 26 MB, alla tolkas på cirka 1,2 s på en Mac): en utskrift från `batterystats` varje gång historiken nollställs, så filen täcker tiden från förra filens namn till sitt eget, med ett tak på 4 MB binärt som kan ta bort de äldsta raderna. Raderna har en av två former: `+1h37m42s570ms (1) 081 +camera` eller `05-22 12:24:57.537 078 c4900011 +camera`. Bara `+top=`/`-top=`, `+screen`/`-screen`, `+camera`/`-camera`, `TIME:`, `START` och `SHUTDOWN` läses. Nyare rader säger vem som använder kameran: `+camera +state=10330:"camera"`, och paketet är det med den uid:n på raderna med `top=` (också senare i filen; `u0a330` är 10330). Uid 1000 delas av flera systemappar, och en uid som inte finns i filen ger ingen app. Rader utan `+state` (på den här telefonen före 2026-03-19) säger inget om appen: `pkgactive=` på samma rad är en annan händelse, och appen är den i `+top` just då. Det är inte alltid samma: i labbet startade Snapchat kameran medan frågan om behörighet låg överst. Appen ligger kvar i `top` medan skärmen är släckt, så intervallet kapas vid `-screen` och tas inte upp igen vid `+screen` (det kan vara låsskärmen). Tiden är lokal i telefonens zon när filen skrevs, med förskjutningen vid varje rads tid: i labbet följs 02:59:49 av 02:00:06 natten då sommartiden slutar, och en rad från juli i en fil skriven i november står i sommartid. Förskjutningen när filen skrevs är filnamnet mot ändringstiden i UTC. Utan telefonens zon: säger förra filen en annan förskjutning spänner filen över ett byte, och raderna räknas inte, för sommartid och resa går inte att skilja åt.
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
- **Telefonens zon** (`readZoneProperty`, `zoneRules`): `persist.sys.timezone` i `/data/property/persistent_properties` (en protobuf med namn och värde per egenskap) är zonen som IANA-namn, på A33 `Europe/Stockholm`. `zoneRules` bygger en tabell över zonens skiften 2005–2040 med `Intl` (en gång per zon, cirka 50 ms) och ger förskjutningen vid en UTC-tid och de möjliga UTC-tiderna för en lokal tid: två i timmen som går två gånger i oktober, ingen i timmen som hoppas över i mars. `clockReader` räknar om lokala tider i skrivordning: tiden som går bakåt in i den timmen är andra varvet. Utan ett sådant steg går varvet inte att avgöra, och raden är osäker (`twice`, en timme). Används så här:
  - *Batterihistoriken:* gäller en fil när förskjutningen då filen skrevs (namnet mot ändringstiden, annars SSRM) stämmer med zonen (`batteryZones`, `rules`). Då räknas varje rad i den nyare formen om med förskjutningen vid sin tid, och i den äldre formen räknas raderna fram från ankarets UTC, eftersom bara ankarna skrivs med förskjutningen vid sin tid. Stegen vid ankarna mäts i UTC: utan det var ett ankare efter bytet ett steg på en timme, och avsnittet före blev osäkert. Hål mellan filerna räknas i UTC när båda filerna har zonen.
  - *SSRM:* raden skrivs när det händer, i zonen då. Zonen gäller när `[RTC]` närmast före och efter stämmer med den (`ssrmZone`), och inte långt (14 dygn) från alla `[RTC]`. Annars gäller `[RTC]` som förut. Så räknas en resa inte om med hemmazonen.
  - *Kontrollen* (`zoneCheck`): eRR.p:s rader, SSRM:s `[RTC]` och batterifilernas namn mot ändringstid jämförs med zonen. Bilagan säger hur många som stämmer, med exempel på dem som inte gör det. Filen med zonen står bland källorna med CRC32 och SHA-256.
  - *Labbet:* 344 av 344 zoner stämmer med `Europe/Stockholm`, och alla 40 filer räknas med zonen. Intervallen som var osäkra bara för zonen gick från 38 (cirka 2 500 timmar, i de två filerna över bytena i mars och oktober) till 0. Säkra rader: app 452 till 458, skärm 236 till 253. Starter, upplåsningar och antalet intervall är desamma; bara fyra steg ändrades, alla i avsnittet där klockan stod på 2021 och 2023. Starten 9 oktober ligger 64 s före eRR.p:s ON-rad.
  - *Rättat samtidigt (1.54):* hål räknades i UTC med varje fils egen förskjutning, så ett byte mellan två filer gav ett falskt hål på en timme. Utan telefonens zon räknas hålen nu i lokal tid.
  - *Inte provat:* en telefon som rest till en annan zon (bara med påhittade rader), timmen som går två gånger med riktiga rader där något hände, och en extraktion utan `persistent_properties` (då gäller loggarnas egna zoner som förut). Rapporternas fält "Time zone settings" är granskningsverktygets visningszon, inte telefonens, och används inte.
- **Skärmdumpens egen app** (`ProvenanceMedia.screenshotApp`, `samsungTrailer`): nyare Samsung lägger en bilaga sist i JPEG-filen (SEF: posterna, katalogen `SEFH` och sist `SEFT`, allt minst värd först). En skärmdump har `Samsung_Capture_Info` = `Screenshot` och `Captured_App_Info` = base64 av `{"comp":"<paket>/<aktivitet>"}`, appen överst när bilden togs. Äldre skärmdumpar har appens namn sist i filnamnet (`Screenshot_20251113-074800_Instagram.jpg`); namnet kopplas till paket med samma namn i App-ID-katalogen. Faktorn "App på skärmen" jämför den appen med loggarna vid T: samma app är Förenligt, en annan Inte förenligt (bara när filen anger ett paket eller ett namn som katalogen känner), och utan loggar står det filen säger med. Jämförelsen hamnar under "Mottagen från någon annan" i förklaringarna. Bilagans poster står på filkortet och i protokollet. Labbet: fyra skärmdumpar från 2026-09-30 anger alla Solflare, och SSRM har Solflare överst 07:46:23–07:47:53 UTC, med bilderna 07:46:37–07:47:45. Den äldre från 2025-11-13 har Instagram i namnet, men ingen logg räcker dit. En Pixel 9 har varken appen i namnet eller någon bilaga, och iPhone sparar inte appen.
- **Samsungs tagningstid i filen** (`ProvenanceMedia.trailerUtc`, `input.samsungUtc`): kamerabilder har `Image_UTC_Data` i samma bilaga, tagningstiden i UTC i millisekunder (och `Camera_Capture_Mode_Info` eller `MCC_Data`). Den står i tabellen under Skapandetid (`file-samsung-utc`) och jämförs med tiden i EXIF i faktorn Skapandetid: inom en minut är en upplysning (kameran skriver båda), jämnt på kvarten när EXIF saknar zon säger att zonen är fel antagen, och annars går tiderna isär (`changed`), eftersom bilagan inte följer med när EXIF ändras i efterhand. Labbet: tre kamerabilder, 0, 0,89 och 0,94 s från EXIF, och MediaStores `datetaken` är EXIF:s tid. Inte provat: en bild vars tid har ändrats i galleriet, och om galleriet då ändrar bilagan också.
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
  html-versionen slutat fungera i en låst Edge är avskriven (2026-11-10): med samma uppsättning som användarens
  fungerade programmet, så problemet verkar ha funnits bara på den datorn.
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
    läses inte om; en lista från disk bedöms; Chattar visar WhatsApp-chatten och en lång chatt på 3 000 meddelanden i block,
    med Första, sökning, ett datum i ett uppehåll och utskriftens varning; listan i Chattar väljs på app, slag och tomma, ett
    nummer hittar gruppen genom deltagaren, och en databas fälls ihop; telefonvyn ställer chatten i ramen, håller platsen vid
    bytet och ger exporten samma utseende; det Chattar har läst och dekrypterat läser Härkomst och Queries inte om; Laboration
    gör steg av standardflöden, loggar dem med tangenterna, stoppar trycken under en väntan och ger tabellen, CSV-filen och en
    logg som går att öppna igen; ett eget flöde byggs i Laboration av mallar, steg och riktiga drag (`c.drag` i `cdp.js`
    trycker ner musen och släpper genom DevTools-protokollet), ändringar ångras, kontrollen varnar, en egen mall ligger kvar
    efter omstart och går att spara och öppna som fil, och långa namn ryms i ett smalt fönster; och HTML ur filnamn,
    databaser och enheters namn körs aldrig. Bara påhittade data, 31 delar (2026-11-12). CI kör det i jobbet `apptest`, som inte stoppar releasen än.
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
- **Chattar (beta):** urvalet i listan, telefonvyn och delningen av läsningen mellan verktygen är provade mot ett labb
  med tio konversationer och ingen grupp (2026-11-11), och annars bara med påhittade data. Inte provat: hundratals
  riktiga konversationer, en riktig grupp, och telefonvyns export ur en riktig extraktion. Listans sökning letar inte i
  meddelandenas text, och ett nummer hittas bara om databasen har det: en WhatsApp-konversation med `@lid` (numret
  står i `LID.sqlite`, som inte läses än) och en Signal-kontakt utan nummer i Signals kontakter hittas på namnet.
  Telefonvyn är en rekonstruktion: telefonens
  textstorlek, tema, modell och appversion finns inte i databasen. Verktygen delar en tråd, så medan ett av dem läser,
  dekrypterar eller kör en fråga står de andra still.
