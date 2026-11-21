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
| `npm run build:standalone` | Den fristående html-filen `release/ForensicsToolbox-X.Y-en-fil.html` (se Den fristående html-filen) |
| `npm run test:html -- --standalone` | Den fristående filen: röktestet, och inget får hämtas via `file://` utöver sidan. `--browser electron` kör den i projektets Electron när Edge och Chrome saknas |

## Windows-build (målplattform)

Cross-build från en enda maskin är opålitligt. Använd:

1. **GitHub Actions** – `.github/workflows/build-release.yml` bygger **Windows**, html-zippen och den fristående html-filen vid push till `main` (ignorerar rena `.md`-ändringar). **Linux och macOS** byggs bara vid behov: Actions → "Bygg och publicera" → Run workflow med plattformar = alla. Eller  
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

## Den fristående html-filen

`ForensicsToolbox-X.Y-en-fil.html` (1.72) är hela verktygslådan utom CyberChef i en enda fil, för datorer där Edge inte
visar verktygen i html-versionen. Där stoppar policyn `IntranetFileLinksEnabled` varje `file://`-navigering som sidan
själv startar, så ramarna med verktygen laddas inte. Idén kommer från CryptoToolbox (`scripts/build-standalone.js`).

- `scripts/build-standalone.js` lägger varje post i sidopanelen i huvudsidan som ett JSON-block
  (`data-ft-src`), med verktygets css och skript inlagda. Filer över 512 kB (kartan, ExifTool, SQLite) ligger en gång
  (`data-ft-shared-src`) och sätts in när verktyget öppnas: annars blev filen över 100 MB, nu runt 43 MB. Härkomst får
  ExifTool direkt (verktyget läser annars in det från exif-viewer, `EXTRA`). Bygget stoppar om något i sidornas
  markup fortfarande pekar på en lokal fil.
- Källkoden ändras inte. `location.search` och `location.protocol` i verktygens egen kod skrivs om till `FT_SEARCH`
  och `FT_PROTOCOL`, som huvudsidan sätter: verktyget får sina parametrar och beter sig som under `file:` i html-zippen.
- `src/script.js` (`FT_STANDALONE`) visar verktyget i en `srcdoc`-ram, utan sandbox, så att ramen har huvudsidans
  origin och lagringen i webbläsaren fungerar. Ramens namn är verktygets sökväg (`tests/app/cdp.js` hittar
  `about:srcdoc`-ramar på namnet). Det som inte är inlagt tas bort ur sidopanelen.
- Kartvyn räknade ut sin mapp ur `document.currentScript.src`, som saknas för ett inlagt skript; det är tåligt nu.
- Provet: `npm run test:html -- --standalone` kör röktestet och underkänner allt som hämtas via `file://` utöver sidan
  (Network-händelser). I CI körs den vid varje push i Edge med `IntranetFileLinksEnabled` på (cirka fyra minuter).
  Den vanliga html-versionen bredvid, som visar att policyn biter, körs bara med edge = alla (se nedan).

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
- Raden högst upp (`#context-bar` i `Toolbox.html`) visas i Härkomst, Queries, Chattar och EXIF
  (`CONTEXT_TOOLS`). Där öppnas, byts och stängs extraktionen; ändringen skickas med `force` till verktyget
  som visas, som då byter även om det visar något. Inne i huvudfönstret döljer verktygen sina egna knappar
  för att öppna och stänga (`body.in-hub .standalone-only`). Verktygen rapporterar
  `{ type: 'extraction-info', file, info: { device } }` (iOS 26.0, Android 13) och
  `{ type: 'current-file', name, path, place }` (filen som visas, `name: null` när den inte visas längre).
  Versionen läses medan zippen öppnas och kommer därför före `extraction-changed`; huvudfönstret sparar
  den (`pendingInfo`) tills beskedet om samma fil kommer.
- Mellan verktygen: raden ber verktyget som har filen om den (`{ type: 'deliver-file', to }`), verktyget
  svarar `{ type: 'file-for', to, files: [{ file, path }] }`, och huvudfönstret öppnar målet och skickar
  `exif-files` (EXIF läser filerna som från disk och öppnar en ensam fil) eller `provenance-files`
  (Härkomst letar upp samma innehåll i extraktionen). Queries skickar filnamnen i ett resultat med `ZFILENAME`,
  `_display_name` eller `filename` som `{ type: 'names-for', to: 'provenance', names, zipName }`.
- Från Härkomst går inget innehåll med i `file-for`, bara hänvisningar (`entriesAsRefs()`): zippens namn, storlek
  och ändringstid, postens nyckel och namn, och filens namn, storlek och tider. EXIF ber om en fil i taget
  med `{ type: 'file-need', token, ref }`, huvudfönstret lämnar frågan till Härkomsts ram utan att byta verktyg, och
  Härkomst svarar `{ type: 'file-content', token, file, times, note, state }` eller `{ …, error }`. Se "Listan till
  EXIF" under Härkomst.

#### Det som står kvar när extraktionen byts eller stängs

Byts eller stängs extraktionen medan en vy visar något som inte hör till den nya, frågar huvudfönstret en gång
om vyerna ska rensas (`askWhatStays()` i `src/script.js`, `#clear-modal` i `Toolbox.html`).

- Bytet görs först och väntar inte på svaret. `setExtraction()` frågar efteråt, och bara när en extraktion
  var öppen före. Öppnas den första extraktionen, eller står ingenting kvar, kommer ingen fråga.
- Huvudfönstret frågar vyerna i `VIEW_TOOLS` (Härkomst, Queries, EXIF och Positioner) med
  `{ type: 'holds-ask', id, file, force }`, och varje vy svarar `{ type: 'holds', id, items, own }`:
  `items` är rader i klartext om det som står kvar, och `own` säger att vyn själv skriver ut vad det hör till
  (Härkomst och Queries). Svaret byggs av `whatStays()` i verktyget och skickas med `toolboxHolds()` i
  `tools/_shared/toolkit.js`. En vy som inte svarar på 1,5 s räknas som att något står kvar. Chattar frågas
  inte, för den följer alltid extraktionen, och Laboration har sina egna extraktioner.
- "Låt stå kvar" (också Esc och klick utanför rutan) ändrar ingenting. Vyerna som inte säger det själva får
  raden `#kept-strip` ovanför verktyget med vilken extraktion innehållet visades för, och knappen "Rensa vyn".
  Raden tas bort när vyn säger att den är tom: verktyget skickar `holds` på eget initiativ efter klick, val och
  släpp när svaret har ändrats, och huvudfönstret frågar om när vyn visas (`checkKept()`).
- "Rensa alla vyer" och "Rensa vyn" låter vyn börja om (`reloadView()`): ramen tas bort och en ny skapas, så att
  ingenting finns kvar av det verktyget hade läst in, fått eller fyllt i. Inställningarna i vyn går tillbaka till
  utgångsläget. Bara vyerna som stod i frågan börjar om. Den nya ramen får extraktionen som gäller när den är laddad.
- Ett nytt verktyg som behåller något över ett byte anmäler det med `toolboxHolds()` och läggs i `VIEW_TOOLS`.
- Medan frågan visas hålls markören i den (`questionFocus`), eftersom Härkomst ställer markören i sin ruta
  när den nya extraktionen är öppnad.
- I testerna svarar `c.keepByDefault()` (`tests/app/cdp.js`) "Låt stå kvar" med knappen inför varje scenario.
  Ett scenario som svarar själv sätter `window.__ftAnswer = 'self'` i huvudfönstret så länge.

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
- Lägesraden kommer ur `ExtractionCore.stageText`: läser, räknar SHA-256 och dekrypterar, alla tre med procent
  (sedan 1.66; `ZipRead.extract` ger `onProgress` för poster som läses i bitar, och `sha256` räknar i bitar om
  `HASH_PIECE` över 2 GB), lägger på `-wal`, väntar på ett annat verktyg (med dess skede) eller hämtar en kopia.
- Härkomsts lägesrad ritas före det som går utan paus i en databas från 8 MB (`PAINT_BYTES`): Telegrams avkodning
  ("Avkodar Telegrams meddelanden i …") och frågorna efter läsningen ("Söker i …"). Förut stod raden kvar på
  "Dekrypterar signal.sqlite (Signal)… 99 %" medan frågorna gick och sidan stod still. En databas där en fråga tar över
  50 ms (`SLOW_QUERY_MS`) får raden ritad först också nästa gång, då med texten som källan har satt. Den texten är
  "Läser Signals databas (beta)…" för filen som läser in databasen och "Slår upp filen i Signal (beta)…" för filerna
  efter den (`appProgress`, sedan 1.66): i en lista såg det annars ut som om databaserna lästes om för varje fil.
  `ZipRead.painted()` väntar på en riktig ritning (en bildruta och en paus, i ett dolt fönster bara pausen). Queries
  skriver "Kör queryn…" på samma sätt.
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
- Frågan och svaret står i en egen ruta överst i faktorn (`.qa` med lägets klass i `render()` i `script.js`, färgerna
  i `style.css`): frågan i fetstil, under den lägets tecken (`STATE_SIGN`) och svaret. Rutan är det ögat ska hitta
  först, så rubriken har inget märke och meningen om vad svaret betyder (`.meaning`) står under rutan utan färg.
- Raden som är den bedömda filen (`bold` på händelsen eller raden) har klassen `ev-file` i Nyckelhändelser och i
  Händelser med källa, med samma bakgrund som filens rad i Positioner. Händelser med källa rullar i en ruta, så
  `showFileRow()` ställer rutan med filens rad i mitten när tabellen öppnas och när en ny fil visas. I kopian för
  Word och i protokollet står raden i fetstil (`eventsTableHtml()` i `report.js`).
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
- Källan för en av filsystemets tider skrivs i klartext, med platsen inom parentes (`fsColumn()` i `timeline-core.js`):
  "Zippen → filens ändringstid (UT-fältet)", "Rapporten → filens skapandetid (report.xml, CreationTime)",
  "Zippen → filens ändringstid (DOS-tid)". Orden är filens ändringstid, filens skapandetid, senast läst och metadata ändrad.
  Namnet i filen står med där det finns ett. I UT-fältet står platsen med för skapandetiden (fjärde tiden) och ctime
  (tredje tiden), eftersom den tolkningen är härledd. Tredje tiden av tre får inget annat ord, den är inte tolkad.
  Härkomsts tabeller, tidslinje och protokoll och EXIF får texten från samma funktion (`handoverTimes()` lämnar den i `sources`).
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
- Listans märken, urval och förlopp (allt som inte rör sidan ligger i `batch.js` och prövas i `batch.test.js`):
  - **Märkena.** Varje faktor står med tecken och ord (`STATE_SIGN` och `ProvenanceCore.STATE_LABEL`, ritade av
    `markHtml()`), så att läget går att läsa utan färgen. Förklaringen ovanför listan (`#batch-legend`,
    `STATE_MEANING`) byggs en gång av `buildBatchTools()`. Rubrikraden är `position: sticky`, så att faktorns namn
    syns när listan rullas.
  - **Urvalet.** `b.filter = { text, group }`. `matches(row, filter)` kräver att varje ord finns i `rowText(row)`
    (namnet, det som söktes, sökvägen, mappen, typen, T, sammanvägningen och radens läge) och att raden hör till
    gruppen (`GROUPS`; `contradiction` är filer med underlag där någon faktor inte är förenlig). Rader utanför urvalet
    göms med `display-none` på sin plats, så att `tbody.rows[i]` fortfarande är `b.rows[i]`; `renderBatchRow()` och
    `backToList()` bygger på det. Föregående och Nästa (`nextOpenable()`) hoppar över gömda rader. Exporterna och
    Visa listan i EXIF tar hela listan, och raden vid urvalet säger det. Urvalet följer med när listan görs
    om för en ny zon eller ett nytt fönster, och en ny lista börjar utan.
  - **En rad per träff.** Ett mål med flera träffar bär det som skiljer dem åt: `choices` (`{ pk }` för rader i
    bildbiblioteket, `{ path }` för poster i zippen) eller `entries` (sökning på innehåll). `expandHits()` byter
    varje sådan rad mot en rad per träff (`hitItems()`: postens kopia med valet och `hit: { n, of }`) och
    `assessRows()` bedömer bara raderna som väntar. Det är samma val som undersökaren annars gör i vallistan, sparat
    på samma sätt, så en lista som görs om behåller raderna.
  - **Förloppet.** `setProgress(id, part, text)` styr stapeln under en lägesrad (`#ex-progress`, `#run-progress`):
    en andel 0–1 fyller den, -1 är en rörlig markering för det som inte har något antal, `null` tar bort den.
    `busy()` visar den rörliga markeringen så länge något pågår; listan sätter antalet klara och
    `progressText()` (tiden som är kvar först efter tre filer och två sekunder), sökningen på hashsumma andelen
    lästa byte, och öppningen andelen av zippens innehållsförteckning och rapportens förteckning.
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
- Bildfilen läses ur zippen och ExifTool-workern från EXIF laddas först när den behövs.
- Positionerna (bildens enligt databasen och EXIF, telefonens enligt routined) visas i en tabell
  och på den delade kartvyn med nålar. Kartbilden hämtas med `mapView.toImage()` och läggs i
  båda exporterna. Kartans laddning kräver att fönstret ritas: med låst skärm kommer ingen
  bildruta, och då går exporten vidare utan kartbild efter tio sekunder.
- På iOS kommer app och kamera ur knowledgeC `/app/usage` (`/app/inFocus` saknas på iOS 18
  och 26, de versioner som kontrollerats, och är bara reserv). Saknas `/app/usage` i fönstret kommer appen ur
  Biome `App.InFocus`, och annars ur PowerLog. Skärmen, låset och kameran per app kommer också ur PowerLog
  (se nedan). Notiserna: se Notiser och Biome. På Android ur `usagestats` (app, skärm, lås) och `appops`
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
  tagningstid, kamera, position, tidszon. Kamerafaktorn bedöms då vid tagningstiden. Se Snapchat Memories nedan
  för kopplingen utan tid (storlek och bilddata).

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

#### Snapchat Memories (beta)

En snap som sparats i Memories kan finnas kvar bara där. Kontrollerat mot labbtelefonerna 2026-11-11 (iPhone med
iOS 26.4.1, steg L38; Samsung med Android 16, steg L40), med en sparad snap per telefon.

- **iOS, `scdb-27.sqlite3`** (`Documents/gallery_data_object/1/<konto>/`, Core Data, Cocoa-sekunder): katalogens
  `snapchat-memories`. `ZGALLERYSNAP` har `ZSNAPID` (= `ZMEDIAID` = `ZGALLERYENTRY.ZENTRYID` i labbet),
  `ZCAPTURETIMEUTC`, `ZCREATETIMEUTC`, `ZCAMERAFRONTFACING`, `ZHASLOCATION`, `ZTIMEZONENAME` och `ZENCRYPTION`, ett
  NSKeyedArchiver-arkiv (`SCMemoriesSnapEncryption`) med `KEY` (32 byte) och `IV` (16 byte). Det finns inga
  koordinater i `scdb-27`; datamodellen (`.mom`) har bara `hasLocation`.
- **iOS, `gallery.encrypteddb`** (`Documents/gallery_encrypted_db/3/<konto>/`): katalogens `snapchat-gallery`, med
  `snap_location_table` (snap-id, latitud, longitud), `snap_key_iv` och `snap_address_title`. SQLCipher-profilen
  `snapchat-gallery` i `sqlcipher.js`: rå nyckel på 32 byte, saltet först i filen, sidor på 1024 byte, HMAC-SHA1 och
  48 byte reserv. Nyckeln är nyckelringens post `egocipher.key.avoidkeyderivation` i Snapchats åtkomstgrupp
  (`isSnapchatGalleryItem` i `app-secrets.js`, `AppSecrets.SNAPCHAT_IOS`), och den letas upp som Signals. Snapchats
  SQLite döper de automatiska indexen till `sqlcph_autoindex_…`; `restoreIndexNames` ger dem SQLites namn i det
  dekrypterade i minnet (samma längd), annars vägrar SQLite läsa schemat. Protokollet säger det.
- **Filen på iOS** ligger i `com.snap.file_manager_3_SCContent_<konto>/` och har en rad i `cache_controller.db` med
  `MEDIA_CONTEXT_TYPE` 19 och `EXTERNAL_KEY` `snap-media-<snap-id>`; typ 26 (`snap-rendered-lowres-<snap-id>`) är en
  förhandsbild som inte gick att dekryptera med samma nyckel. Filen är AES-256-CBC med `ZENCRYPTION`s nyckel och IV
  (`snapMemoryContent` → `innerContent`, som Signals bilagor), också när `IS_ENCRYPTED` står som falskt.
  Summorna i filkortet gäller filen som den ligger; raden Innehållet ger det dekrypterades storlek och SHA-256.
- **Kopplingen fil → snap** är id:t i cachenyckeln (`snapchat.js`: `parseExternalKey` kind `memory`, `build` →
  `memory.by = 'id'`), aldrig tiden. `addSnapchat` hämtar snappen på id (`role-memory-id`) också utanför fönstret,
  lägger positionen ur `gallery.encrypteddb` på raden och sätter `file.memory` med `columns` (iOS-kolumnerna, så att
  texterna i `timeline-core.js` säger rätt kolumn, `memCols`), `anchor: 'cache'` och `positionSource`.
- **Android:** en fil i `files/file_manager/memories_media/` hör till den snap vars `memories_media.size` är filens
  storlek, när bara en snap har den (`memoryBySize`, `role-memory-size`, `by: 'size'`). En bild i galleriet som
  exporterades ur Memories har samma bytes som filen i `memories_media` med EXIF tillagt: utan APP-segment
  (`ProvenanceSnapchat.jpegCore`) jämförs den byte för byte med filerna av samma storlek (`memoryByContent`,
  `by: 'content'`). Kopplingen på tid (fem sekunder) gäller fortfarande när exporten skedde direkt. I labbet kom
  exporten två minuter efter, så den kopplades inte före den här ändringen.
- **Sökning på id:** ett snap-id, media-id eller Memories-id i filnamnsrutan (`snapMemoryFile` i `runOutsideLibrary`)
  pekar ut filen: på iOS via `role-cache-memory` (cachefilen med `snap-media-<id>`), på Android via storleken i
  `memories_media` (`memoryFileOf`). Filkortet och protokollet säger "Sökt på snap-id" (`foundBy.algo = 'snap'`). En
  Memories-post kan ha flera snaps: alla med fil står i en lista att välja ur, och statusraden säger hur många som
  saknar fil. Ett id som inte finns i Memories ger samma besked som ett filnamn som inte finns.
- **Snap utan fil:** finns snappen i Memories men inte filen (den kan finnas kvar bara på Snapchats server) visar
  `renderMemoriesWithoutFile` det som står om den: tagen, sparad, sort och kamera, position (iOS ur
  `gallery.encrypteddb`) och varför filen saknas, med knappen "Sök filer kring tagningen" som fyller i sökningen på
  tid. Programmet hämtar aldrig något från Snapchats server, och texten säger att snap-id:t är det som pekar ut
  snappen där.
- **Video på iOS:** att `ZMEDIATYPE` 1 är video och om `ZCAPTURETIMEUTC` är inspelningens start eller slut är inte
  kontrollerat. Texterna säger det (`videoTimeText` i `timeline-core.js`), och en dekrypterad fil som är en video
  räknas som video oavsett `ZMEDIATYPE` (`typeNote` säger när de inte stämmer).
- **Skickad i en chatt:** på iOS 26 är en skickad snaps `EXTERNAL_KEY` två UUID:er (`<a>~<b>`), och båda står i
  meddelandets `local_message_references` i `arroyo.db` (`messageForRefs`). Vem chatten är med ger
  `role-conversation-members` (avsändarna i hela konversationen utom det egna kontot). En sparad snap och den snap som
  skickades har inget gemensamt id, så `snapSends` jämför bilderna: båda förminskas till 24 × 24 rutor i gråskala
  och medelskillnaden räknas (`grayDiff`). Under `SAME_IMAGE_DIFF` (4 av 255) räknas de som samma bild, och
  skillnaden står i texten och i faktorn *Snapchat igång*. I labbet: samma bild 0,4–2,0, andra bilder av samma
  skärm 16–31. Bara bilder och bara iOS; på Android finns ingen sparad snap som skickats i labbet.
- Video, story, export, text på bilden och My Eyes Only på iOS är provade 2026-11-19, se nedan. Inte provat: äldre
  Snapchat-versioner på iOS (andra `scdb-NN`) och del 2 av labben (ominstallation) på iPhone. Android är provat i 1.71, se nedan.

#### Snapchat Memories på iOS, laborationerna 2026-11-19

Labbtelefonen (iPhone, iOS 26.4.1, Snapchat 14.30.0.59), flödet `docs/labbar/snapchat-memories-iphone-del1.json` två
gånger i rad, och en hel extraktion med nyckelringen efter båda. I den första var telefonen i
flygplansläge fram till S09. Facit: `tests/app/facit/lab-snapchat-memories-iphone.json`, körs med
`npm run test:app -- --memories` när zippen finns (`FT_LAB_MEMORIES_IOS_DIR`, annars `1 Labbar/2026-11-19 iPhone - Snapchat Memories` under en labbrot, se nedan).

- **Video:** `ZMEDIATYPE` var 0 för både bild och video. `ZMEDIAFORMAT` 0 är video och 1 bild, och en video har
  `ZSERVLETMEDIAFORMAT` tom och `ZDURATION` som längden (en bild har 10). `ProvenanceSnapchat.isVideoMemory`.
  `ZCAPTURETIMEUTC` är inspelningens slut: 1,5 och 0,1 s efter trycket när avtryckaren släpptes.
  Filen i cachen har nyckeln `<snap-id>~1` med typ 19, samma form som en inspelning, och två filer (båda MP4).
  `memoryVideoKey`, och `role-cache-memory` tar med dem.
- **När snappen sparades:** för en video och för snaps i en story som sparades efteråt är `ZCREATETIMEUTC` = tagningen,
  och tiden då posten sparades står i `ZGALLERYENTRY.ZDUPLICATETIMEUTC` (samma sekund som filen lades i cachen). För en
  bild som sparas direkt är de samma. `iosMemoryOrigin` tar den senare. En story med två snaps blev två poster.
- **Export ur Memories:** Snapchat kodar om bilden, så bytena är inte desamma som i Memories (som på Android). Exporten
  har ingen EXIF-position och ingen UserComment, och en video har ett uuid som `ZORIGINALFILENAME`. `linkSnapMemoryIos`
  jämför filen med varje sparad bild som sparades före den, förminskade till 24 × 24 i gråskala med texten ovanpå
  (`memoryGrid`, räknas en gång per zip): rätt snap 0,2–0,4, nästa närmaste minst 4,6 med alla bilder tagna av samma
  skärm. Kopplingen kräver att en enda är under `SAME_IMAGE_DIFF`. En video kopplas på längden: bildbibliotekets
  `ZDURATION` (ny i `role-file` från iOS 14) mot `ZGALLERYSNAP.ZDURATION`, 31 ms skillnad båda gångerna.
- **Snapchats egen kopia** (Spara till = Memories och kamerarullen) lades till samma sekund som `ZCREATETIMEUTC` och hade
  EXIF-position och Snapchats version i UserComment. Den kopplas på tiden som förut.
- **Inställningen Spara till** står i `primary.docobjects`, `userproperties` `itemId` 24 (samma nummer som på Android),
  som text i FlatBuffern `p` (`saveSettingFromFlat`, `role-save-setting`, `snapSaveSettingIos`). Ingen tid. Huvudfilen hade
  en äldre sida med `MEMORIES_AND_CAMERA_ROLL`; WAL:en det nuvarande `MEMORIES`.
- **Texten på bilden** ligger i en egen fil, `snap-overlay-<id>` (WebP med genomskinlighet, samma nyckel). En snap som
  skickas ur Memories har texten inbränd: utan texten var skillnaden 5,9–6,1, med den ritad ovanpå 0,14–0,24 (`snapOverlay`,
  `grayGrid(bytes, type, overlay)`).
- **Skickad snap i Snapchat 14.30:** cachenyckeln är bara ett uuid (typ 3), och samma uuid står i det egna meddelandets
  `local_message_references`. `build` gör den till `sent`. I flygplansläge skrevs filen när användaren skickade och
  meddelandet i `arroyo.db` 1 min 32 s senare. Bildjämförelsen går igenom alla skickade snaps i fönstret (`out.sent`),
  också de som inte får plats bland de 40 händelserna; en träff läggs till i tidslinjen.
- **My Eyes Only:** snappen kopieras till en ny rad med `ZDUPLICATEDFROMSNAPID` = originalets id och originalets tider,
  posten får `ZISPRIVATE` 1, och originalets rad tas bort. Filen i cachen är densamma men krypteras om; nyckeln i
  `ZENCRYPTION` gäller inte längre. När den flyttades syns i cachen: originalets `snap-media-<id>` får `DELETED_TIMESTAMP_MILLIS`
  och kopians rad skapas samma sekund. Sökning på originalets id hittar kopian (`role-memory-id`).
- **Sökning på id:** början av ett id räcker också på iOS (`LIKE … || '%'`). Listan har snappens fil i cachen och kopian
  eller exporten i kamerarullen med skälet i Varför (`snapGalleryCopiesIos`).
- **Flygplansläge:** snaps som togs då har `ZHASLOCATION` 0 och ingen rad i `snap_location_table`.
- Inte kopplat: id:t för en sparad snap som skickas står bara på frigjorda sidor i `arroyo.db` (en sändkö som tömts,
  `SCSnapCommonLoggingParams`). Programmet läser inte frigjorda sidor, så kopplingen görs på bilden. Video som skickas
  ur Memories jämförs inte (bara bilder).

#### Snapchat Memories på Android, laborationen 2026-11-16 (1.71)

Labbtelefonen (OnePlus Nord, Android 13, Snapchat 14.32) i två delar, med hela `/data` extraherat efter varje del
(utom appar, NetHunter-chroot och den låsta användaren 10). Facit: `tests/app/facit/lab-snapchat-memories-oneplus.json`,
körs med `npm run test:app -- --memories` när zipparna finns.

- **Inställningen Spara till** står i `core.db`, `SnapchatUserProperties` rad `_id` 24 (`textVal`): `MEMORIES`,
  `MEMORIES_AND_CAMERA_ROLL` eller `CAMERA_ROLL` (värdena står i appen). `row_version` 0 är standardvärdet som aldrig
  ändrats (Samsung-zippen), `last_updated_time` är när raden skrevs på telefonen: vid en ändring, eller vid
  inloggningen. Inställningen följer kontot: efter en ominstallation hämtades samma värde och `row_version`.
  Katalogen `snapchat-android-core` (`save-setting`, `role-save-setting`), `ProvenanceSnapchat.saveSetting`,
  `snapSaveSetting` i `script.js`, och en rad i *Skapandetid* (`settingText`).
- **Kopian i galleriet:** med kamerarullen i inställningen lade Snapchat en kopia av varje sparad snap i
  `DCIM/Snapchat` med `date_added` samma sekund som `create_time` (−0,5 till +0,02 s i labbet). En export ur Memories
  ger en ny fil senare. `copyKind` skiljer dem (`AUTO_COPY_MS`), och *Skapandetid* säger vilken det är.
- **Raden hämtad från servern:** efter en ominstallation, och efter en uppdatering, är `create_time` =
  `snap_capture_time`, och `snap_create_user_agent` är appen som läser raden (14.30 blev 14.32 på samma snaps).
  `memories_entry.create_time` stod däremot kvar på millisekunden, så `memoryOrigin` tar tiden då snappen sparades
  därifrån (`savedMs`, `savedFrom: 'entry'`). Protokollet kallar user agent "appen som skrev raden".
  `memories_entry.source` var 0 på alla poster, också de som hämtats från servern, så den skiljer inte enheterna åt.
- **Rader ur kamerarullen:** `camera_roll_id` satt betyder att Snapchat lagt in en bild ur galleriet i Memories
  (också själv, som en "featured story" med `memories_entry_id` featured). Tagningstiden är filens, och ingen kamera
  är inblandad. På Android 13 är värdet MediaStores `_id`, på Android 16 ett uuid. Sådana rader kopplas aldrig som
  filens ursprung; en rad med filens `_id` nämns i *Skapandetid* (`importText`).
- **My Eyes Only:** `memories_entry.is_private` = 1. En snap som flyttas dit får en ny rad med `copy_from_snap_id`,
  och den gamla får `has_deleted` = 1. Kopian i galleriet ligger kvar okrypterad.
- **Video exporterad senare** har annan storlek och tid men samma längd: 6,618 s mot 6,609 s i Memories, den
  automatiska kopian 6,687 s. `linkVideoByDuration` kopplar när en enda video ligger inom `SAME_DURATION_MS` (150 ms),
  och texten ber undersökaren kontrollera videon. MediaStores `duration` läses i en egen roll, `media-extra`, så att en databas utan kolumnen inte stoppar filens rad.
- **Avinstallerad app:** `owner_package_name` töms. En fil `DCIM/Snapchat/Snapchat-<tal>.jpg|mp4` räknas då som
  Snapchats (`isGalleryName`, `file.importerFrom = 'name'`), och typen säger varför.
- **Loggarna rensas vid avinstallation:** Snapchats 46 rader för kameran (op 26) och övriga ops i appops, och dess
  8 händelser i usagestats under labben, var borta efter ominstallationen; andra appars rader fanns kvar (alla
  815 appops-filer skrevs om till en). När appen installerades står i
  `data/system/users/0/package-restrictions.xml` (`first-install-time`, ABX;
  `ProvenanceAppVersions.firstInstallFromRestrictions`). Ligger tiden som frågas före den, får *App igång* och
  *Kamera igång* läget Upplysning med "Loggarna rensade" (`reinstalled` i `timeline-core.js`).
- **Flera enheter:** Snapchat tillåter flera inloggade enheter (Session Management i Snapchats hjälp). Memories
  följer kontot, så texterna säger inte "på den här telefonen" om en sparad snap; det gör kamerafaktorn, ur appops.
- **Sökning på id:** början av ett id räcker (minst åtta tecken, `LIKE … || '%'` i `role-memory-id`). På Android
  listas också galleriets filer som hör till snappen, med skälet i kolumnen Varför (`snapGalleryCopies`): raden med
  `camera_roll_id`, kopian samma sekund, en kopia kring tagningen när raden är hämtad från servern, samma bilddata
  (export) och samma längd (video). En fil i galleriet bedöms genom sin rad i bildbiblioteket.
- **Meddelanden från kontot på en annan enhet** (samma konto inloggat i Snapchat för webben, två bilder ur filer och två
  snaps med datorns kamera till en vän): de står i telefonens `arroyo.db` med kontot som `sender_id` och
  `created_on_device` 0. Telefonens egna har 1. Efter ominstallationen var flaggan 0 och `local_message_references`
  tom på alla meddelanden, också telefonens, så 0 från tiden före installationen säger inget (`sentFrom` i
  `snapchat.js`, med `ctx.installMs` ur `package-restrictions.xml`). En snap tagen i Snapchat för webben har länken
  `…/web/mobile-landing.html?ref=web_snap_context` i `message_content` (`device: 'web'`); bilderna ur filer hade
  `content_type` 2 och ingen länk. Ett meddelande från kontot är skickat (▲) i tidslinjen oavsett enhet. Webben kan
  inte spara i Memories. Queries visar enheten i kolumnen `skapat_pa`.
- Inte kopplat: en skickad snap ur Memories (P09, P10) har inget id från Memories i meddelandet i `arroyo.db`.

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
  - **Låssidan:** sidan med byten på plats 1 GB (sida 262145 med sidor på 4096 byte) skriver SQLite aldrig på, så i en
    databas över 1 GB står den tom i filen och kan inte ha en HMAC som stämmer. Är den tom räknas den inte som skadad
    (`stats.lockPage`), och protokollets rad säger det. Kontrollerat 2026-11-13 med en okrypterad SQLite-databas på 1,1 GB
    (sidan är bara nollor, `integrity_check` ok), inte mot en verklig SQLCipher-databas över 1 GB: ingen sådan finns här.
    En låssida som inte är tom och inte stämmer räknas som förut.
  - **Vilka sidor:** numren på de fem första sidorna med fel HMAC sparas (`stats.badPages`) och står i protokollets rad
    och i varningen (`badText()`), så att den som undersöker kan se var i filen felet ligger.
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

#### Många filer i Härkomst (1.62)

Det som gäller hela extraktionen görs en gång per öppnad zip. Det som gäller filen görs en gång per fil. Uppmätt på
iPhonen ur tvåtelefonslabbet (634 000 poster i zippen): en lista med 3 070 namn, varav 3 000 inte finns, gick från
245 s till 18 s, och ett klick på en rad i listan från 0,5–1,1 s till omkring 0,1 s. Underlaget var detsamma före och
efter för 104 filer på båda telefonerna.

- **Uppslag i förteckningen (`zip.js`):** en `keep` till `ZipRead.scan` kan säga vad den söker: `keep.bases` (filnamn
  utan mapp, små bokstäver) och `keep.crc` (CRC32). Med en förteckning i minnet prövas då bara posterna med de
  filnamnen eller den summan (`lookup`, `hinted`), i förteckningens ordning. Den som sätter fälten lovar att `keep`
  säger nej till allt annat, och `keep` avgör fortfarande varje post, så svaret är detsamma som vid en hel genomgång
  (`zip.test.js` jämför de två). Utan förteckning i minnet läses allt som förut. `Copies.keeper`,
  `MediaCard.suffixKeeper` och sökningarna i `script.js` (`findMedia`, `telegramCamera`) sätter fälten.
- **Frågor för hela extraktionen (`runRole`):** en fråga utan värden, eller med bara fönstret `ALL_TIME`, ger samma svar
  för varje fil. Svaret sparas på den öppnade databasen (`loaded.answers`, nyckel: frågans id, tidskolumnerna och
  SQL-texten) och raderna fryses, så att en ändring av en delad rad blir ett fel i stället för ett annat underlag
  för nästa fil. Frågan skrivs ändå i varje fils protokoll (`run.queries`). Frågor med filens eget fönster körs per fil.
- **ExifTool (`readTags`):** svaret sparas som text per SHA-256 och filnamn (`state.tags`, högst `MAX_TAG_TEXT`
  tecken, äldst ut först) och varje läsning får en egen kopia. Utan SHA-256 (ingen `crypto.subtle`) sparas inget.
- **Listan (`renderBatchRow`):** en körning ritar bara raden som blev klar och den före, inte hela tabellen per fil
  (det var kvadratiskt: 36 s av 245). Vägen tillbaka från en rad ritar om de rader som öppnats och de med samma fil.
- **`ProvenanceApp.work()`** räknar körda och återanvända frågor och ExifTool-anrop. Röktestet läser det: samma fil
  en gång till, och ett klick i listan, läser inte ExifTool igen, och underlaget och protokollets frågor är desamma.
- Sedan 1.66 sparas det listan visar om raden, se "Det som redan är gjort görs inte om", och sedan 1.67 hela
  bedömningen per rad, se "Hela underlaget per fil finns kvar i minnet".

#### Långa listor i Härkomst (1.65)

En användare hade en lista med omkring 3 000 mediefiler ur en Android-extraktion, och programmet räknade med 60–90
minuter. Två saker tog tiden, och ingen av dem syntes i mätningen för 1.62, som mest gjordes med namn som inte fanns:

- **Loggarna lästes om för varje fil.** `ProvenanceAndroidLogs.pickDiscrete` väljer alla appops-filer som skrivits
  efter fönstrets början (upp till 600), och var och en packades upp, summerades och avkodades för varje mediefil.
  Detsamma gällde usagestats mappningar och dygnsfiler. Nu läses en loggfil en gång per öppnad zip (`logOnce(entry,
  kind, decode)`, nyckel: sorten och postens plats i zippen), det avkodade fryses (`deepFreeze`) och urvalet ur
  appops sparas per uppsättning filer (`state.zip.appopsSets`). `work.logs` och `work.logsReused` räknar.
- **ExifTool blev långsammare för varje fil.** Se "ExifTool i EXIF-visaren": varje fil får nu en ny Perl-instans.

Det som byggdes ovanpå det:

- **Flera ExifTool (`exifPool`).** Upp till `EXIF_WORKERS` workrar (kärnorna minus en, högst fyra; sex från tolv kärnor sedan 1.66, se "Fler
  workrar" nedan) med en kö
  (`askExifTool`, `exifPump`). En worker startas först när en fil väntar och ingen är ledig. Efter `EXIF_RENEW`
  (100) filer avslutas workern och en ny tar över, så att minnet efter de gamla Perl-instanserna lämnas tillbaka på
  en gång (uppmätt: sidans minne nådde 4,2 GB på 1 127 filer utan bytet och 2,8 GB med). När listan är klar
  behålls en worker (`exifShrink`).
- **Läsning i förväg (`lookAhead`, `startAhead`).** Filerna bedöms fortfarande en i taget och i listans ordning.
  I förväg görs bara det som inte beror på något annat än filen: raden slås upp, filen packas upp, summorna räknas
  och ExifTool läser den, för `aheadRows` rader framåt (två per worker) och högst `AHEAD_BYTES` uppackat som väntar.
  Det lästa ligger under postens plats i zippen (`state.ahead.reads`) och under SHA-256 och filnamn
  (`state.tags.early`), och bedömningen hämtar det i `readMedia`, `readPaired` och `readTags`. Stämmer inget av det
  läser bedömningen själv. Läsningen i förväg är alltså bara ett förråd: databaser och loggar frågas enbart av
  bedömningen, och ingen ordning mellan workrarna kan ändra ett svar. `assessRows` väntar i sin `finally` på det
  som ännu läses, också när listan avbryts, så att inget arbete är kvar efteråt.
- **Tiden som är kvar** (`ProvenanceBatch.progressText(done, total, elapsedMs, paceMs)`) räknas på de senaste
  högst 25 filernas takt. Den första filen läser in databaserna, och räknad på snittet sedan starten blev
  uppskattningen flera gånger för lång.
- **Mindre arbete per fil:** paketnamnet för en app slås upp en gång (`androidPackage`), en post i zippen packas
  upp en gång per bedömning (`assessEntry`), `Copies` sorterar sökvägarna efter en klassning per sökväg, MD5 i
  `hashing.js` har sina 64 steg utskrivna (omkring 380 MB/s) och CRC32 i `zip.js` tar åtta byte i taget
  (`CRC_BY8`, omkring 1 370 MB/s). MD5 prövas mot Nodes egen i `hashing.test.js` och CRC32 mot en räkning med en
  byte i taget i `zip.test.js`.

Uppmätt på Samsungen ur tvåtelefonslabbet (`1 Labbar/2026-11-11 Två telefoner (iPhone och Samsung)/Android/`, 28,6 GB): 400 namn gick från 89–100 s
i 1.64 till 16 s, och alla 1 127 namn tar 38 s (129 s utan läsning i förväg). På iPhonen ur samma labb gick 55 filer
ur kamerarullen från 13,8 s till 3,5 s. Radernas text är densamma som i 1.64 för 400 rader på Samsungen och 55 på
iPhonen, och `ProvenanceApp.list()` är lika tecken för tecken med och utan läsning i förväg. Av de 38 sekunderna är
ungefär 17 räknande i fönstrets egen tråd, och det är golvet nu.

- **Provkörningen** når det här genom `ProvenanceApp.list()` (radernas namn, läge och sammanfattning), `exif()`
  (workrarna och kön), `readAhead(rader)` (0 stänger av läsningen i förväg) och `forgetTags()` (glömmer ExifTools
  sparade svar). Röktestet 'Härkomst: en lista som läser filerna i förväg ger samma rader som utan …' kör samma
  lista på båda sätten, jämför raderna och antalet frågor, och ser att workrarna är lediga efter en klar och en
  avbruten lista.
- **Inte uppmätt:** 3 000 filer (labbet har 1 127 namn; minnet i fönstret växte med omkring 0,6 MB per fil), en
  Windows-dator, och användarens egen extraktion.

#### Stora Signal-databaser i Härkomst: förloppet och loggen (1.66)

En användare körde en lista i 1.65 mot en Android-extraktion med en `signal-logs.db` på 4,2 GB. Programmet stod i
omkring fem minuter med "signal-logs.db" på lägesraden utan att något rörde sig. Samsungen i tvåtelefonslabbet har
ingen läsbar Signal, så mätningarna för 1.62 och 1.65 hade ingen sådan kostnad alls. Det här är uppmätt på en
påhittad extraktion på utvecklarens Mac (`signal-logs.db` 4,2 GB med 14,9 miljoner rader, `signal.db` 1,4 GB):

| Skede för `signal-logs.db` | 1.65 | 1.66 |
| --- | --- | --- |
| Läser ur zippen | 10 s, ingen procent | 10 s, procent |
| Räknar SHA-256 | 24 s, ingen procent | 24 s, procent |
| Dekrypterar | 12 s, procent | 13 s, procent |
| Söker (frågan över hela loggen) | 90 s, sidan står still | 83 s, procent, sidan står still högst 0,6 s åt gången |
| Varje fil därefter | 3,9 s, sidan står still | omkring 0,15 s |

Sex namn tog 164 s kallt och 23,5 s varmt i 1.65, och 142 s och 0,9 s i 1.66. `ProvenanceApp.list()` är lika tecken
för tecken i de fyra körningarna.

- **Stegets stapel (`step(part)` i `script.js`, `#run-step`).** Ett långt steg inom en bedömning har en egen stapel
  med andelen och tiden steget har tagit. I en lista står den under listans stapel, som räknar filer och därför
  står på "0 av N klara" medan databaserna läses in, med texten "Görs en gång för hela listan". För en enda fil
  är det stapeln under lägesraden. `loadDb` och `runRoleInParts` sätter den, och tar bort den i sin `finally`.
- **Den rörliga markören** (ett steg utan känd andel) flyttas med `transform` i stället för `left`, så att den kan
  fortsätta röra sig medan fönstrets tråd är upptagen. Det är inte kontrollerat med ögat under en fråga som
  blockerar.
- **Frågan över hela loggen i tidsdelar (`splitByTime`).** En fråga i sql.js går varken att följa eller att avbryta,
  och frågan över Signals logg tog en och en halv minut. En rollquery kan därför ha `"splitByTime": true` i
  katalogen. Det är ett löfte om frågans form: den väljer rader vars tid (`fields.time`, `unixMs`) ligger i fönstret
  med gränserna inräknade, sorterar på tiden först och sedan entydigt, och har ingen `LIMIT`.
  `ProvenanceRoles.inParts` kör den då för tidsdelar i följd som delar gräns: del k är [a, b] och del k+1 är
  [b, c], och raderna i nästa del med tiden lika med gränsen hoppas över, så att ingen rad tappas eller dubbleras
  också när tiden inte är ett heltal. Delarnas bredd följer tiden de tar (mål 100 ms, högst en fördubbling per del,
  aldrig smalare än en `PARTS_MAX`-del av loggens tid). Mellan delarna ritas lägesraden och stapeln, högst var
  200:e ms. Svaret är rad för rad det hela frågan ger, sparas under samma nyckel som den (`loaded.answers`), och
  protokollet får den hela frågan, så att den går att köra i Queries som förut.
- **När den inte delas:** loggens första och sista tid kommer ur rollen `coverage`. Saknas de, eller slår databasen
  inte upp tiden i ett index (`EXPLAIN QUERY PLAN` ska ha en rad `SEARCH … (tid>? AND tid<?)` och ingen `SCAN`,
  `ProvenanceRoles.searchesByTime`), körs hela frågan på en gång som förut. Utan index skulle varje del läsa hela
  tabellen.
- **Tolkningen en gång per extraktion (`ProvenanceSignal.prepare`).** Varje fil tolkade om hela den matchade loggen
  och slog upp bilagorna på nytt: 3,9 s per fil med 75 000 loggrader. Nu görs det en gång per inlästa databaser
  (`prepared` på det som `addSignal` sparar), och bedömningen av en fil tar bara händelserna i sitt fönster
  (`ctx.keep`). Appversionerna ur loggen (`AppVersions.signalLogVersions`) likaså. `signal.test.js` jämför svaret
  med och utan det förberedda.
- **Tester:** `roles.test.js` kör katalogens fråga mot en riktig sql.js-databas hel och i delar, med fyra olika
  klockor och spann och rader precis på gränserna, och jämför rad för rad. `catalogs.test.js` håller fast formen
  på den märkta frågan. Röktestet 'Samsung med Signal: …' har Signals två databaser krypterade som på Android
  (`signalAndroidEntries` i `tests/app/fixtures.js`, tabellerna påhittade efter frågornas kolumner) och ser stegets
  stapel, att loggen söktes i flera delar (`work.parts`), och att filen kopplas till valet i galleriet och meddelandet.
- **Inte gjort:** sökningen i loggen tar lika lång tid som förut. Den läser varje rads text mot sexton mönster, och
  ingen snabbare fråga med samma svar är funnen. Två enkla byten gav samma rader men ingen vinst över en tiondel av
  den påhittade loggen: `LIKE` 8,4 s, `GLOB` 10,9 s (och skiljer på stora och små bokstäver), ett JavaScript-mönster
  per rad genom `create_function` 7,6 s; att bara läsa raderna tog 0,6 s. Att spara svaret på disk mellan körningarna skulle lägga uppgifter
  ur ärendet utanför extraktionen, och är inte gjort (underhållaren ville inte ha det, 2026-11-13).
- **Inte uppmätt:** användarens egen extraktion och en Windows-dator.

#### Meddelandena i en tabell i minnet (`indexByTime`, 1.66)

Signals `message` på Android har inget index på tiderna frågan väljer på, så frågan efter meddelandena i en fils
fönster (`role-messages`) läste igenom hela tabellen för varje fil: 0,17–0,23 s per fil mot en påhittad `signal.db`
på 1,4 GB med en miljon meddelanden. Underhållaren ville inte ha dolda gränser eller något sparat på disk, utan att
uppgifterna görs sökbara i minnet.

- **Katalogen:** `"indexByTime": ["date_sent", "date_received", …]` på en rollquery är ett löfte om frågans form:
  den väljer raderna där någon av de kolumnerna i svaret ligger i fönstret, gränserna medräknade, har fönstret som
  enda platshållare och ordnar raderna entydigt. Bara Signal på Android är märkt. `catalogs.test.js` håller fast
  formen.
- **Bygget (`ProvenanceRoles.timeIndex`, `buildTimeIndex` i `script.js`):** frågan körs en gång över hela tiden,
  och svaret läggs med `CREATE TABLE … AS` i en minnesdatabas som bifogas anslutningen (`ATTACH ':memory:' AS
  ft_index`), med ett index per tidskolumn. Avbilden av databasen rörs inte: `PRAGMA query_only` är av bara medan
  tabellen byggs. Lägesraden säger "Ordnar meddelandena i signal.db (Signal) efter tid…".
- **Uppslaget (`runRoleByTime`):** en fils fönster slås upp i tabellen, ordnat efter `rowid`, vilket är frågans
  ordning. Svaret jämförs med frågan mot databasen för varje fönster tills ett fönster med rader har gett samma
  svar tecken för tecken. Skiljer de sig, eller går tabellen inte att bygga, tas den bort, källan får en varning,
  och varje fil frågas direkt som förut. Inga trösklar: tabellen byggs alltid när frågan är märkt.
- **Protokollet** har frågan mot databasen, som går att köra om i Queries, och källan har raden "Uppslag" som
  säger att svaret lades i en tabell i minnet, hur många rader, och att uppslaget prövades mot frågan.
- **Uppmätt** på den påhittade extraktionen (utvecklarens Mac): bygget 3 s en gång och omkring 70 MB per miljon
  meddelanden i sql.js minne. Sex namn: 142 s kallt som förut, 0,5 s varmt (0,9 s utan tabellen). 600 av Signals
  bilagor i en lista: 196 s med tabellen och 271 s utan, alltså 0,09 s per fil mot 0,22 s efter att databaserna
  lästs in (omkring 145 s, en gång). Listorna är lika med och utan.
- **Tester:** `roles.test.js` bygger tabellen i en riktig sql.js-databas och jämför uppslaget med frågan för många
  fönster, också med rader precis på gränserna. Röktestet 'Samsung med Signal: …' ser att tabellen byggdes en gång
  (`work.indexBuilt`), att uppslagen gick dit (`work.indexed`) och att ett prövades mot databasen
  (`work.indexChecked`).

#### Listan till EXIF: hänvisningar, och Signals bilagor dekrypterade (1.66)

En användare hade 3000 filer i Härkomsts lista och tryckte på knappen till EXIF. Härkomst läste då in
filerna i minnet tills en gräns på 1 GB var nådd (104 filer), lämnade över dem, och EXIF kunde inte visa
något: filerna var Signals bilagor (`app_parts/part….mms`), som ligger krypterade i extraktionen.

- **Hänvisningar i stället för innehåll (`entriesAsRefs` i Härkomst).** Varje fil lämnas över som zippens namn,
  storlek och ändringstid, postens nyckel och namn, och filens namn, storlek och tider. Ingen gräns för antal eller
  storlek, och inget läses i Härkomst vid knapptrycket. Härkomsts lägesrad säger hur många som skickades, och
  hur många som inte längre finns i zippen, med de fem första vid namn.
- **EXIF ber om en fil i taget** (`content(row)`): `{ type: 'file-need', token, ref }` till huvudfönstret,
  som lämnar frågan till Härkomsts ram utan att öppna eller byta verktyg. Härkomst (`fileNeeded`, `answerNeed`)
  svarar i tur och ordning med `{ type: 'file-content', token, file, times, note, state }` eller `{ …, error }`.
  Innehållet hålls bara medan ExifTool läser det (`row.held`). En liten bild (240 punkter, `keepThumb`) sparas till
  listan när bilder visas, och detaljvyn hämtar innehållet på nytt när raden öppnas. Video får ingen bild i listan.
- **När det inte går** står skälet på raden (flaggan "Fel" och raden "Läsningen" i detaljvyn med "Försök igen"):
  en annan extraktion är öppen i Härkomst, Härkomst är inte öppet, filen finns inte i zippen, eller läsningen gick
  fel. Skickas listan igen läses sådana rader om, liksom rader som låg krypterade utan nyckel.
- **Signals bilagor (`signalContent`).** En fil under `org.thoughtcrime.securesms/app_parts/` slås upp på namnet i
  `attachment.data_file`. Nyckeln är HMAC-SHA256(bilagenyckeln `modernKey`, `data_random`), innehållet AES-256-CTR
  med noll-IV, kapat vid `data_size`. Innehållets SHA-256 jämförs med `data_hash_end` i samma rad, och raden
  "Innehållet" på filkortet och i protokollet säger om summan är densamma, inte stämmer eller saknas. Filens egna
  CRC32, MD5 och SHA-256 är fortfarande de för filen som den ligger i zippen. EXIF och bilden läses ur det
  dekrypterade innehållet, och protokollets tabell heter då "EXIF-tagg i det dekrypterade innehållet". I EXIF &
  karta får raden flaggan "Dekrypterat innehåll", och flaggan "Fel filändelse" tas bort (`.mms` är Signals namn på
  filen, inte en ändelse för innehållet).
- **Utan nyckel eller rad** sägs skälet i klartext ("Bilagenyckeln (modernKey) saknas…", "Ingen rad i signal.db
  pekar ut filen…"), ExifTool frågas inte, och raden i EXIF får flaggan "Krypterad".
- **T ändras inte.** En bilaga utan rad i galleriet har zippens ändringstid som T, som förut; tiden i det
  dekrypterade innehållet står bland filens tider men flyttar inte T. Förut frågades ExifTool om den krypterade
  filen två gånger per bilaga utan att kunna få svar (när T bestämdes och i förväg); nu frågas det en gång, om
  innehållet, och läsningen i förväg dekrypterar när `signal.db` redan är inläst (`r.inner`).
- **Uppmätt** på en påhittad extraktion (utvecklarens Mac: `signal-logs.db` 4,2 GB, `signal.db` 1,4 GB, 3000
  bilagor på 150 kB–50 MB, 1,8 GB sammanlagt): Härkomsts lista med alla 3000 tog 767 s med två ExifTool-anrop per
  bilaga och 474 s med ett (omkring 145 s inläsning en gång, sedan 0,11 s per fil; fönstret stod still sammanlagt
  80 s, mest under sökningen i loggen, längst 3,7 s). Raderna stod i EXIF efter 2 s, alla 3000 var lästa och
  dekrypterade efter 451 s (0,15 s per fil), detaljvyn visade en bilaga på 50 MB efter 0,8 s. Av tiden stod
  fönstret still omkring 90 s i stycken på högst 1,2 s: EXIF ritar om hela tabellen var 1,5:e sekund medan
  filer läses, och det tar längre ju fler rader som finns. Det gäller också filer från disk och är inte ändrat.
- **Tester:** röktestet 'Härkomst → EXIF: …' (också i HTML-utgåvan) har en bilaga krypterad med Nodes
  `crypto`, inte med programmets egen kod (`signalAndroidPart` i `tests/app/fixtures.js`), och går igenom: utan
  bilagenyckel, listan som hänvisningar, med bilagenyckel, listan en gång till, detaljvyn, knapparna i raden högst
  upp åt båda håll, och extraktionen stängd. `FT_ONLY=<text>` kör bara delarna med den texten i namnet.
- **Inte gjort:** Signals bilagor på iOS, bilder i listan för video, och gränsen på 200 MB för Härkomsts egen
  EXIF-läsning (som säger till när den slår till). **Inte uppmätt:** användarens egen extraktion och Windows.

#### Fler workrar gav inget förrän tre andra saker var ändrade (1.66)

Frågan var om fyra ExifTool-workrar kunde bli åtta eller tolv. Uppmätt på samma påhittade extraktion som ovan
(utvecklarens Mac, tolv kärnor, 600 av bilagorna, tiden per fil efter inläsningen):

| | 1 worker | 4 | 6 | 8 | 12 |
|---|---|---|---|---|---|
| som det var | 0,113 s | 0,088 s | | 0,086 s | 0,088 s |
| efter de tre ändringarna | | 0,024 s | 0,019 s | 0,019 s | 0,018 s |

Med fyra workrar arbetade i snitt 1,6 av dem, och ingen fil väntade på en ledig. Tiden gick på annat:

- **Bilagans rad letades fram bland alla bilagor för varje fil** (`ProvenanceSignal.match`, hälften av tiden i en
  profil med 62 500 bilagor). `prepare` gör nu ett uppslag på filens namn i `app_parts/` (`byFile`), en gång.
  Utan `prepared` letar `match` som förut, och `signal.test.js` jämför de två vägarna.
- **Dekrypteringen räknades i JavaScript i sidans egen tråd** (en sjundedel). `SqlCipher.ctrAsync` använder
  webbläsarens AES-CTR (räknaren är hela blocket, `length: 128`) och räknar i JavaScript om WebCrypto saknas eller
  nekar. `sqlcipher.test.js` jämför båda vägarna med Nodes `aes-256-ctr`, också när räknaren slår runt.
- **Lägesraden ritades före varje uppslag i en databas som en gång varit långsam** (`loadDb`, `had.slow`): en
  bildruta per databas och fil, omkring 50 av de 70 ms som återstod per fil, medan både sidans tråd och workrarna
  stod lediga. Nu ritas raden först bara om en fråga i databasen tog över `SLOW_QUERY_MS` för den här filen eller
  filen före (`slowRound` mot `fileRound`, som räknas upp i `assess`). En databas som frågas långsamt för varje fil
  får alltså raden ritad som förut. Inget eget test: det som går att se är tiden, och den beror på datorn.

Först efter det arbetade alla fyra workrar (3,7 i snitt, filer väntade på en ledig i 88 % av proven). Sex gav en
femtedel kortare tid per fil. Åtta och tolv gav inget mer: varje ExifTool-anrop tog längre ju fler som arbetade
(91 ms med fyra, 102 med sex, 116 med åtta, 142 med tolv), och sidans egen tråd var upptagen till hälften.
`EXIF_WORKERS` är därför sex på en dator med tolv kärnor eller fler och som förut annars. Det är uppmätt på en
dator; med färre kärnor är sex inte prövat, och därför inte valt där.

Hela listan med 3000 bilagor: 474 s före, **217 s** efter (omkring 145 s inläsning en gång, sedan 0,023 s per fil;
sidans tråd upptagen 72 % av den tiden, så med så många rader är det åter den och inte workrarna som sätter
takten). Inläsningen, nästan bara sökningen i loggen på 4,2 GB, är orörd och är det mesta av tiden för listor upp
till ett par tusen filer. **Inte uppmätt:** användarens egen extraktion, Windows, riktiga Signal-data, och hur
mycket minne sex workrar tar jämfört med fyra.

#### Det som redan är gjort görs inte om (1.66)

Fyra ändringar efter en genomgång av vad Härkomst läser och räknar flera gånger. Allt ligger i minnet och försvinner
när extraktionen stängs (`closeZip`). Inget skrivs till disk, och avbildningen läses bara.

- **Signals databaser släpps inte när nyckeln är densamma (`dropCipherDbs`).** Varje ändring i nyckelrutan, också
  samma nyckel inklistrad en gång till, stängde de dekrypterade databaserna, och nästa bedömning läste, räknade
  summor, dekrypterade och sökte loggen igen. Nu minns varje dekrypterad databas vilken profil och nyckel den
  öppnades med (`cipherOf`, en `WeakMap`, så nyckeln står inte i `state.loaded`), och den stängs bara när nyckeln
  är en annan. Tas nyckeln bort ställs databaserna undan (`state.kept.parked`): de står då inte i `state.loaded`
  och därmed inte bland protokollets källor, och bedömningen säger som förut att nyckeln saknas. Kommer samma
  nyckel tillbaka sätts de in igen, i den ordning de lästes (`loaded.seq`), så att protokollet räknar upp källorna
  som förut. En annan nyckel stänger dem.
- **Listans rader sparas (`state.kept.rows`).** En rad som är klar (`done`, `missing` eller `ambiguous`) sparas med
  det listan visar om den: läge, anmärkning, sammanfattning, nyckel och mål. Nyckeln är vad raden pekar på
  (`itemKey`: namn, biblioteksrad, post, summa eller fil från disk, med vald rad eller sökväg), tidsfönstret, zonen
  och nyckelläget (`keyState`: Signals profil, nyckel och källa, och bilagenyckeln). Samma lista en gång till, en
  lista med fler namn och ett fönster som undersökaren redan har haft läser därför bara de filer som inte är
  bedömda. Ett fel sparas inte, och en nyckel som ändras medan listan går gör att resten av den listan inte sparas
  (`keyChanges`).
  - **Det syns.** Raden `#batch-kept` under listan säger hur många filer som visas som de bedömdes förut, och
    knappen "Bedöm listan på nytt" (`freshBatch`) glömmer de raderna och bedömer dem igen. Lägesraden säger också
    hur många som inte lästes. Utan det skulle ett tillfälligt läsfel eller en ändring utanför programmet inte gå
    att få bort annat än genom att stänga extraktionen.
  - **Hela bedömningen** (`{ model, meta }`) sparades inte i 1.66, så ett klick på en rad och Nästa bedömde filen
    i sin helhet. Sedan 1.67 sparas den, se "Hela underlaget per fil finns kvar i minnet". En enskild fil (`run()`)
    sparas inte. Exporten av listan (`exportBatch`) nämner inga databaser och är densamma för en sparad rad som för
    en nybedömd.
- **MD5 per SHA-256 (`md5For`, `state.kept.md5`).** SHA-256 räknas alltid på det som lästes. MD5, som räknas i
  JavaScript i sidans tråd, tas ur minnet när samma SHA-256 har setts förut i samma extraktion.
- **Listan ritas utan att leta och släpper fram fönstret.** `renderBatchRow` slog upp raden med `tbody.rows[i]`
  efter att ha bytt `outerHTML`, och det uppslaget går från tabellens början varje gång: 20 000 namn tog 8–9 s med
  fönstret fruset i ett stycke. Raderna hålls nu i `batchEls` och byts med `replaceChild`. En lista som inte
  behöver läsa något från disk väntade heller aldrig, så den gick inte att avbryta. `assessRows` släpper nu fram
  fönstret (`ZipRead.pause()`) när det har gått `listFreeMs` (50 ms) sedan sist.
- **Loggsökningen i delar efter antal rader.** Delar med lika lång tid tog olika länge, eftersom en logg är tät i
  vissa perioder: den längsta stod still i över tre sekunder. När frågeplanen säger i vilken tabell och vilket
  index tiden slås upp (`ProvenanceRoles.edgeQuery`) frågar `rowEdge` efter tiden hos den n:te raden efter den
  förra gränsen (`ORDER BY tid LIMIT 1 OFFSET n-1`, som går i indexet), och `inParts` skär där. Antalet rader per
  del följer tiden delen tog (mål `PART_MS`, 50 ms). Gränserna styr bara hur länge en del tar: raderna i svaret är
  desamma, och raderna i en gräns tas med en gång som förut. Går tabellen inte att läsa ur planen, eller går
  gränsfrågan inte i indexet, delas frågan efter tid som i avsnittet ovan.
- **Räknare och krokar.** `ProvenanceApp.work()` har fått `loaded` (inlästa databaser), `rowsKept` (rader tagna ur
  minnet), `md5` och `md5Kept`, `freed` (gånger en lista släppt fram fönstret) och `byRows` (frågor delade efter
  antal rader). `forgetRows()` glömmer de sparade raderna och summorna, och `listFree(ms)` sätter `listFreeMs`
  (0 = efter varje rad), båda för provkörningen.
- **Tester:** `roles.test.js` jämför frågan hel, i tidsdelar och i delar efter antal rader, rad för rad. Röktestet
  'Härkomst: en lista som är bedömd visas igen utan att läsas …' ser att samma lista inte läser något, att bara
  nya namn bedöms, att knappen bedömer på nytt med MD5 ur minnet, och att 3 000 namn går att avbryta (stoppet
  utlöses av antalet klara rader, inte av en tid). 'Samsung med Signal: …' klistrar in samma nyckel igen, tar bort
  den, sätter tillbaka den och byter den, och jämför antalet inlästa databaser och protokollet (utan tiden det
  skapades och de ritade bilderna, som också bär tiden).

Uppmätt på utvecklarens Mac, på den påhittade extraktionen från avsnitten ovan (signal-logs.db 4,2 GB, signal.db
1,4 GB, 3 000 krypterade bilagor):

| | före | efter |
|---|---|---|
| samma nyckel inklistrad igen, sedan en fil | 144 s | 0,6 s |
| nyckeln borttagen och inklistrad igen, sedan en fil | 144 s | 0,6 s |
| en lista med 300 filer en gång till | allt utom ExifTool om igen | 0,3 s (5,0 s första gången) |
| samma lista med 100 namn tillagda | alla 400 om igen | 2,1 s, bara de 100 nya |
| ett fönster som listan redan har haft (400 filer) | 2,2 s | 0,4 s |
| alla 3 000 en gång till | | 0,6 s (56 s för de 2 600 som var nya) |
| en tangenttryckning under loggsökningen, längsta väntan | delar på upp till 0,6 s | 50 ms (median 22 ms) |

- **Loggsökningen** gick i 1 660–1 681 delar efter antal rader. Väntan är mätt med en riktig tangenttryckning
  genom fönstrets inmatning (`Input.dispatchKeyEvent`) med oregelbundna mellanrum, 321 stycken under sökningen,
  som tiden från att händelsen skapades till att sidan hanterade den. En klocka i sidan (`setTimeout`) fick vänta
  tre delar i taget och säger alltså för mycket: mät med inmatning. Det som görs en gång tar lika lång tid som
  förut (143–145 s).
- **Stopp som är kvar i det som görs en gång:** bygget av meddelandetabellen i minnet (`buildTimeIndex`, en enda
  `INSERT … SELECT`, 3,6 s), frågan efter loggens första och sista tid och antal rader (omkring 1 s), 0,7 s när
  signal.db lämnas till SHA-256, och två enstaka på 0,4 s. SHA-256 över loggen går i bitar som en tangenttryckning
  väntade högst 0,09 s på.
- **Ett klick på en rad** bedömer filen i sin helhet, eftersom hela bedömningen inte sparas. ExifTools svar och
  MD5 tas ur minnet, filen läses och SHA-256 räknas. Tiderna som stod här (0,2–0,3 s per klick, 0,2 s per Nästa)
  var för höga: i dem låg provkörningens egen väntan mellan avläsningarna. Mätt i sidan är det 0,04–0,1 s, se
  tabellen i "Hela underlaget per fil finns kvar i minnet".
- **20 000 namn som inte finns** (Samsungen ur tvåtelefonslabbet): förut 8–9 s med fönstret fruset i ett stycke
  och utan möjlighet att avbryta. Nu 5,3–5,9 s i stycken på upp till 1,0 s, med 35 ritade bildrutor, och Avbryt
  listan stoppade 1,1 s efter klicket. 1 000 namn tar 0,3 s och 5 000 tar 0,8 s. Samma 20 000 en gång till: 0,9 s.
  - **Det som är kvar är webbläsarens eget arbete, inte programmets.** I en profil är 1,2 s av 6,2 JavaScript.
    Resten är layout och målning: att byta en enda rad i en tabell med 20 000 rader kostar omkring 0,1 s (53 ms
    layout och 51 ms bildruta, uppmätt i vila), och under körningen 0,2–0,4 s per bildruta. `table-layout: fixed`,
    en rubrikrad utan `position: sticky` och `contain` på raderna ändrade ingenting.
  - **Kortare tid mellan gångerna fönstret släpps fram gör det långsammare**, eftersom varje gång blir en
    bildruta: 10 ms gav 17,5 s och efter varje rad 49 s. Därför 50 ms.
  - Under det går det inte att komma med alla rader i sidan. Det som återstår är att bara ha de rader som syns
    i sidan (en lista som ritar sitt synliga utsnitt). Det är inte byggt.
- **Listan med 3 000 filer:** fönstrets tråd var upptagen 39,5 av 56 s, och i profilen var 41 av 63 s webbläsarens
  eget arbete. Med 600 filer tog listan 9,8 s både med tabellen synlig och dold (`display: none`), så där är det
  inte ritningen som sätter takten. Vid 3 000 rader kan den göra det, och det är inte uppmätt hur mycket.
- **Inte uppmätt:** användarens egen extraktion, Windows, riktiga Signal-data, och hur mycket minne de sparade
  raderna tar (`performance.memory` gav samma tal i varje prov och säger inget).

#### Hela underlaget per fil finns kvar i minnet (1.67)

Ett klick på en rad i listan, Nästa och Föregående bedömde filen i sin helhet: filens egna frågor ställdes igen
(19 per fil på labb-iPhonen), filen lästes och underlaget byggdes. Nu sparas hela bedömningen (`{ model, meta }`)
med raden när listan bedömer filen, och raden öppnas ur den.

> **På prov (beslut 2026-11-15).** Vinsten är liten på det som gått att mäta, omkring 30 ms per klick (se
> tabellen nedan). Underhållaren valde att behålla det, med förbehållet att det ska ses över eller tas bort om det
> ger problem. Kom tillbaka hit om något av det här visar sig:
>
> - en rad som öppnas ur listan visar något annat än samma fil bedömd för sig,
> - underlaget följer inte med när fönstret, zonen eller en nyckel har ändrats,
> - minnet växer, eller sidan stängs av webbläsaren, med långa listor,
> - raden under listan (`#batch-memory`) säger något som inte stämmer, eller är i vägen.
>
> **Pröva utan det:** `ProvenanceApp.kept(0)` i Härkomsts konsol sätter taket till noll. Då sparas inga underlag,
> de som finns släpps, och varje klick bedömer filen i sin helhet som i 1.66. Försvinner felet då ligger det här.
> `ProvenanceApp.kept(null)` ställer tillbaka.
>
> **Ta bort det:** låt `keepRow` sluta anropa `keepFull` och `openBatchRow` sluta anropa `showKept` (då används
> alltid `run`/`assessEntry`), och ta sedan bort `keepFull`, `dropFull`, `fullOf`, `roughBytes`, `showKept`,
> `previewForKept`, `refill`, `renderBatchMemory`, `state.kept.fulls`/`fullBytes`, `asked` i `meta`, kroken
> `kept`, räknaren `shownKept`, raden `#batch-memory` i `index.html` och röktestets scenario. `previewOf` och
> att `batchOne` lämnar tillbaka bedömningen kan stå kvar. Det listan visar om raden (`state.kept.rows`, 1.66)
> berörs inte.

- **Var det ligger.** `keepRow` får bedömningen av `batchOne` och lägger den på radens sparade post
  (`state.kept.rows`, `had.full`) med `keepFull`. Allt ligger i minnet. Inget skrivs till disk, och extraktionen
  läses bara.
- **Öppna en rad (`openBatchRow` → `showKept`).** Finns underlaget kvar för raden och nyckelläget som gäller
  (`fullOf`) visas det utan att `assess` körs: ingen fråga, ingen ExifTool-läsning, ingen summa. Bara bilden läses
  ur zippen igen (`previewForKept`; Signals bilaga dekrypteras då igen), eftersom filens innehåll inte sparas.
  `work().shownKept` räknar. `state.redo` sätts som vid en vanlig bedömning, så ett annat fönster eller en annan
  zon medan filen visas bedömer den på nytt.
- **Det som visas är en kopia av det yttre lagret** (`Object.assign({}, full.meta)`). Tumnageln och bilderna som
  ritas till exporten skrivs på kopian och ligger inte kvar när nästa fil visas. Av samma skäl sparar `finalize`
  en kopia utan dem (`plain`) när ett klick har bedömt filen i sin helhet.
- **Tiden underlaget skapades** (`createdText`, som också ritas in i tidslinjens bild) är tiden då listan bedömde
  filen, inte tiden för klicket. Allt annat är lika med en ny bedömning.
- **Taket sägs ut.** Underlagen får ta högst hälften av det minne webbläsaren ger sidan (`KEEP_SHARE` av
  `performance.memory.jsHeapSizeLimit`, 1,8 GB i Electron på utvecklarens Mac). När det är nått ger först äldre
  listors underlag plats (`state.kept.fulls` är i den ordning listorna användes, `takeKept` flyttar fram dem som
  en ny lista tar över). Räcker inte det sparas inga fler, raden `#batch-memory` under listan säger hur många
  filer som har underlaget kvar, ungefär hur mycket det tar och var taket ligger, och de övriga bedöms i sin
  helhet när raden öppnas, som före 1.67. Ingen fil lämnas alltså utan underlag, och inget kortas.
- **Påfyllning (`refill`).** En rad som bedöms i sin helhet vid ett klick, med listans fönster och zon och samma
  nycklar, får sitt underlag sparat om det får plats. `asked` i `meta` säger vad bedömningen gjordes med. Zonen
  jämförs som den gäller: "Varje bilds egen zon" är datorns zon för en fil utan egen zon.
- **Storleken är en uppskattning (`roughBytes`).** Texter räknas tecken för tecken, med ett påslag per tal,
  lista, objekt och fält. Det som delas av alla filer räknas inte: svar som gäller hela extraktionen
  (`keepAnswer`) och lästa loggar (`logOnce`) är frysta, och frysta objekt hoppas över. Utan det räknades
  tidsmängden i två svar (7,6 MB) en gång per fil, och 240 av 3 000 filer sades fylla taket fast de tog 5 MB.
  `ROUGH_SHARE` (2/3) är avstämd mot minnet mätt utifrån: före den var uppskattningen 30 kB per fil mot 18–21 kB
  verklig ökning (påhittade Signal-bilagor) och 83 kB mot 56 kB (labb-iPhonens kamerarulle).
- **Det som inte sparas:** en enskild fil utanför en lista (`run()`), en rad med flera träffar (den bedöms när
  undersökaren har valt, varje gång), och en rad med fel.
- **Krokar:** `ProvenanceApp.kept()` ger `{ rows, full, bytes, limit }`, och `kept(n)` sätter taket i byte för
  provkörningen (`null` = det vanliga) och släpper de äldsta underlagen ned till det.
- **Test:** röktestet 'Härkomst: en rad öppnas ur underlaget som finns kvar i minnet …' jämför det som visas ur
  minnet med en ny bedömning (modellen, protokollets delar, texten utan tiden det skapades, bildernas mått),
  byter fönster medan en fil visas, sätter taket till 0, mellan två listor och mitt i en lista, och läser raden
  under listan. Det går också i HTML-utgåvan.

Uppmätt på utvecklarens Mac. Tiden är från klicket tills arbetet är klart, mätt i sidan; "målat" är två bildrutor
senare.

| | utan sparat underlag | ur minnet |
|---|---|---|
| labb-iPhonens kamerarulle (55 filer), Nästa, klart | 54–59 ms | 34 ms |
| samma, målat | 97–98 ms | 66 ms |
| samma, klick på en rad, klart | 43–68 ms | 30–31 ms |
| påhittad extraktion, 300 Signal-bilagor, Nästa | 37 ms | 32 ms |
| samma, lista med 3 000, klick på rad 5 / 1 500 / 2 999 | 88 / 303 / 90 ms | 93 / 264 / 87 ms |

- **Vinsten är liten på det som gått att mäta**: bedömningen vid ett klick var redan snabb efter 1.62–1.66. Den
  blir större där filens egna frågor tar tid; lägesraden efter en lista säger tiden per fil, och det är ungefär
  vad ett klick kostade.
- **Klicket mitt i en lista med 3 000 rader** tar 0,26–0,30 s med och utan sparat underlag. Det är alltså inte
  bedömningen. Vad det är har inte mätts.
- **Minnet**, mätt utifrån efter skräpsamling (`HeapProfiler.collectGarbage`, `Runtime.getHeapUsage`): 3 000
  Signal-bilagor 61 MB (omkring 20 kB per fil), labb-iPhonens 54 filer 3 MB (56 kB per fil). Att visa 102 rader ur
  minnet ökade det med 0,2 MB.
- **Inte uppmätt:** användarens egen extraktion, Windows, och en lista så stor att taket nås på riktigt.

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
- **Utseendet** (1.76):
  - **Färgerna** per app och läge står i `style.css` som block med en bakgrund och en textfärg för varje bubbla
    (`--bubble-them`, `--bubble-them-text`, `--bubble-me`, `--bubble-me-text`). Allt annat i bubblan, som citat,
    länkar och flaggor, tar bubblans textfärg (`currentColor`). Varningen under en bilaga har egna färger.
    `style.test.js` läser blocken och kräver minst 4,5:1 för text, tid, systemrad, namn och initial i varje app och
    läge. Förut stod namnet i ett citat i en egen Signal-bubbla med 1,1:1 i ljust läge.
  - **En färg per person** (`ChatCore.hueOf`, åtta färger `--p0`–`--p7`): namnet i en grupp, ringen med initialen
    vid avsändaren och ringen i listan. Exporten färgar namnet på samma sätt. Initialen står i `data-initial` och
    ritas av CSS, så att den inte blir en del av texten.
  - **Följder** (`ChatCore.sameRun`): meddelanden från samma avsändare, högst fem minuter isär och samma dag, står
    tätt (`.cont`, `.more`), med mindre hörn mot avsändaren och namnet och ringen en gång per följd. En systemrad,
    ett samtal eller en saknad tid bryter följden. Exporten har kvar namnet på varje meddelande.
  - **Till senaste** (`#c-latest`) syns när det senaste meddelandet inte är nära, och ritar slutet av chatten.
- **Telefonen** (`phone.js`, `ChatPhone`, och `device-info.js`, `DeviceInfo`): extraktionen som en telefon, i
  telefonvyns ram. Ett eget verktyg i sidopanelen: samma sida som Chattar med `?view=phone` (`PHONE_TOOL`, klassen
  `phone-tool` döljer listan), i en egen ram med nyckeln `tools/phone` (`data-key` på menyraden i `Toolbox.html`;
  `openTool` och `createFrame` i `src/script.js` skiljer på ramens nyckel och sidan som laddas). Knappen Telefonen
  överst i Chattars lista öppnar samma vy i Chattar. Ingen klocka, batterinivå eller mottagning ritas, och foten
  säger att det är en rekonstruktion.
  - **Filerna** (`DeviceInfo.FILES`, `fileOf`, `pick`) hittas på sökvägen i en genomgång av zippen och läses en gång
    per extraktion (`loadDeviceInfo`). Av en fil som ska läsas en gång tas den med kortast sökväg; kopior i
    programuppdateringar och säkerhetskopian av kontona hoppas över, och `/data/user/0` räknas som `/data/data`.
    Databaserna läses med sin `-wal` som Chattars egna (`ExtractionCore.loadDatabase`, delas mellan verktygen).
    Inställningar → Källor listar varje fil som lästes, med storlek och CRC32, och de som inte finns.
  - **Hemskärmen** följer telefonens egen när filen finns:
    - iOS: `SpringBoard/IconState.plist` (`iosHome`). `iconLists` är sidorna, `buttonBar` dockan; en sida har
      bundle-id, mappar (en ordbok med `displayName` och egna `iconLists`) och widgetar (`elements` med `gridSize`:
      small 2×2, medium 4×2, large 4×4). Filen har bara ordningen, så platsen räknas ut: första lediga plats rad för
      rad i ett rutnät med fyra kolumner (`packPage`), som iOS gör när inget har flyttats. Det står under sidan.
    - Samsung One UI 6 och senare: `com.sec.android.app.launcher/databases/OneUI.db` (`oneUiHome`). `item_group` har
      hemskärmen (`homescreen`), dess sidor (`page` under `workspace`, i `rank`-ordning) och dockan (`hotseat`).
      `item` har appar, mappar och widgetar med `position_x`, `position_y`, `spanX` och `spanY` (−1 är en ruta);
      `container_type` 1 betyder att posten ligger i mappen `container_id`. Applådans poster ger namnen på alla appar.
      Samsungs äldre `launcher.db` har på One UI 8 bara tomma tabeller.
    - Launcher3 (Pixel och de flesta andra): `databases/launcher*.db`, tabellen `favorites` (`launcher3Home`).
      `container` −100 är skrivbordet (sida `screen`), −101 dockan, annars mappen med det `_id`:t. `itemType` 0 app,
      1 och 6 genväg, 2 mapp, 4 och 5 widget. Rutnätet står i filnamnet (`launcher_4_by_5.db`). Finns flera filer
      används den som ändrades senast och har `favorites`.
    - Utan fil visas apparna med data som förut. Apparna med data som inte ligger på hemskärmen (i applådan eller
      appbiblioteket), och Inställningar, får en sista sida "Med data, inte på hemskärmen".
    - Storleken: telefonen är 25,9 × 52 em och em följer fönstrets höjd (10–24 px, `.c-stage.phone` är en container
      och bredden `cqw` begränsar). Chattens yta är lägre, så där blir ramen kortare men lika bred. Sidan, prickarna
      och dockan ligger i `.d-home`, som fyller skärmen; noten står under. `fitHome` ritar sidan mindre (ned till
      0,6) när rutnätet inte ryms, till exempel 5 × 6 eller 6 × 7 på en stor Samsung, och körs igen när ytan ändras.
    - Apparna med data öppnas (`roleOf`: bundle-id och paket för WhatsApp, Signal, Telegram och Snapchat, Bilder och
      Inställningar). WhatsApp Business har en egen databas och räknas inte som WhatsApp. En annan app visar ett ark
      med id:t, platsen och var namnet kommer ifrån. En mapp öppnas i ett ark, och en app i den öppnas därifrån.
      Sidorna byts med prickarna, pilarna i vyn eller piltangenterna.
    - Namnen (`appName`): Apples egna appar på svenska ur en tabell (Info.plist har det engelska namnet), annars
      `CFBundleDisplayName` eller `CFBundleName` i appens `Info.plist` (iOS, osynliga riktningstecken borttagna) eller
      launcherns titel (Android), sedan App-ID:s katalog och sist id:t. En widget utan känt appnamn heter som klassen i
      komponenten (`widgetName`). Ikonerna är verktygets egna: appens färg och symbol för apparna med data, annars en
      färg ur namnet och första bokstaven.
  - **Ikonerna** på Android är telefonens egna: launcherns ikoncache `databases/app_icons.db` (tabellen `icons` i
    Launcher3, också hos Samsung: `componentName`, PNG i `icon`, `label`, för `profileId` 0) i samma app som hemskärmen,
    och ikonen som Launcher3 sparade på raden i `favorites.icon`. Saknas båda ritas verktygets egen. iOS-ikonerna ligger
    i appens paket i Apples egna PNG-variant (CgBI) eller i `Assets.car` och ritas inte.
  - **Andra märken**: allt utom hemskärmen kommer ur Androids egna filer och är samma hos alla tillverkare. Hemskärmen
    läses ur One UI och ur varje `launcher*.db` med tabellen `favorites` (Launcher3 och det som bygger på den). En
    launcher med ett annat schema (Huawei, Honor) ger en rad i Inställningar med filen och dess tabeller, och Telefonen
    visar apparna med data. Provat på Samsung och Pixel; OnePlus, Xiaomi, Motorola och andra är inte provade.
  - **Låsskärmen** (knappen överst på hemskärmen, eller ett drag nedåt från överkanten) visar notiserna, den senaste
    först, med en rubrik per dag och telefonens bakgrund för låsskärmen bakom. En notis öppnar ett ark med alla fält och
    källan.
    - Android: notishistoriken `system_ce/0/notification_history/history/<ms>` (`notificationHistory`): protobuf
      NotificationHistoryProto med en strängpool (1) och en post per notis (3): 1 paket, 3 kanalens namn, 5 kanalens id,
      7 uid, 9 tiden i ms, 10 titeln, 11 texten, 13 konversationen; 2, 4, 6 och 14 är samma strängar som plats i poolen
      (inte provat). Samsung skriver också 15, notisens nyckel. Finns bara när Notishistorik är påslagen, och Android
      sparar ungefär ett dygn: Samsung A33 hade 17 notiser från extraktionsdagen, Pixel 9a ingen fil.
    - iOS: Biomes `Notification.Usage/local` (`ProvenanceBiome.notificationUsage` och `notifications`, samma som
      Härkomst): appen, titeln (för Snapchat avsändarens namn) och tiden, med händelsernas typer. Texten sparas inte där.
      `ProactiveHarvesting.Notifications` var tom i labbtelefonen. iPhonen i `Snapchat Laboration` hade 90 notiser från
      2026-09-30 till 2026-11-19.
  - **Att dra med musen** (`pointerdown` och `pointermove` på `#c-device-body`, bara `pointerType` mouse): i sidled byter
    hemskärmen sida (60 px räcker, ett kortare drag glider tillbaka), åt höger på de andra skärmarna går det tillbaka,
    och i höjdled rullar listor och galleriet. Ett drag är inget klick (en lyssnare i fångstfasen stoppar klicket efter).
    Finger och penna har webbläsarens egen rullning.
  - **Bakgrunden** läggs bakom hemskärmen och låsskärmen, förminskad till 720 bildpunkter; namnen står då i vitt med
    skugga. Bara de två skärmarna har den (`renderDevice` tömmer `backgroundImage` innan en skärm ritas).
    - Android: `system/users/0/wallpaper` och `wallpaper_lock` (en bildfil utan ändelse, känd på de första byten,
      `imageType`), med komponenten ur `wallpaper_info.xml` (ABX). Samsung (One UI) sparar ingen fil `wallpaper` för
      standardbilden, men en miniatyr av bakgrunden i `wallpaper_thumbs/<n>/thumbnail_0` (JPEG; en mapp med udda nummer
      först) och låsskärmens bild i `wallpaper_lock_images/wallpaper_first` (PNG). Båda fanns i A33-labbarna 2026-11-06
      och 2026-11-11. Utan `kwp` är låsskärmen samma som hemskärmen.
    - iOS 16 och senare: PosterBoards `PBFPosterExtensionDataStoreSQLiteDatabase.sqlite3` har postrarna (`poster`:
      UUID, providerId), rollerna (`posterRoleMembership`) och attributen (`posterAttributes`). Den valda postern för
      `PRPosterRoleLockScreen` har attributet `SELECTED` = 1; saknas det tas den med senast `lastModifiedDate` i
      `PRPosterRoleAttributeTypeUsageMetadata` (`DeviceInfo.posterChoice`). Postern har en bild av hemskärmen och
      låsskärmen i `Extensions/<provider>/configurations/<UUID>/versions/<n>/RuntimeSnapshot-home.atx` och `-lock.atx`,
      den högsta versionen (`posterSnapshots`). Det är Apples texturfil: `AAPL\r\n\x1a\n`, delar med längd och namn
      (`HEAD` med formatet 0x93B0, ASTC 4 × 4, och bredd och höjd; `astc` med datan; `END `). Blocken ligger i
      grafikminnets ordning: rutor om 32 × 32 block rad för rad, Morton-ordning inom rutan med y på de jämna bitarna,
      och bredden utfylld till hela rutor med tomma block. `tools/_shared/astc.js` (`Astc`) avkodar ASTC (LDR, 2D) i
      JavaScript utan WebAssembly och väljer den ordning där inga tomma block hamnar i bilden. Kontrollerat 2026-11-20
      mot tre iPhone-labbar (iOS 26.4.1, 828 × 1792, ungefär 40–85 ms): Apples standardbakgrund (`MercuryPoster`) och en
      fotoposter ritades rätt. Före iOS 16: `SpringBoard/HomeBackgroundThumbnail.jpg` och `LockBackgroundThumbnail.jpg`.
  - **Inställningar** är en lista som i telefonen, en del i taget, och varje rad säger fil och fält:
    - iOS: Om telefonen (`ComputerName` i `SystemConfiguration/preferences.plist`, `SystemVersion.plist`, nummer, ICCID
      och senaste nät i `com.apple.commcenter.plist`), Wi-Fi (`com.apple.wifi.known-networks.plist`: tillagt, senast
      ansluten ur `BSSList[].LastAssociatedAt` eller `JoinedBy…At`, hur och av vilken app), Konton (`Accounts3.sqlite`,
      ett per namn med sina slag), Lägen (`DeviceInfo.iosToggles`: flygplansläge ur `SystemConfiguration/com.apple.radios.plist`
      `AirplaneMode`, Wi-Fi ur `SystemConfiguration/com.apple.wifi.plist` `AllowEnable`, Bluetooth ur
      `com.apple.BTServer.plist` `defaultPoweredState` och läget i flygplansläge, platstjänster ur
      `com.apple.locationd.plist` `LocationServicesEnabledIn…` (mobile eller root), utseende ur
      `com.apple.uikitservices.userInterfaceStyleMode.plist` (1 ljust, 2 mörkt), batteriprocent, senast avstängd ur
      `com.apple.springboard.plist`, språk och region ur `.GlobalPreferences.plist`, den valda orten i
      `com.apple.preferences.datetime.plist`, Fokuslägena ur `DoNotDisturb/DB/ModeConfigurations.json` och de som är på
      ur `Assertions.json`, säkerhetskopian ur `com.apple.MobileBackup.plist` `BackupStateInfo` och
      `AccountEnabledDate`, och inställningsassistentens `SetupLastExit`; tiderna i vald zon), Bluetooth (parkopplade
      Bluetooth LE-enheter i `com.apple.MobileBluetooth.ledevices.paired.db` `PairedDevices`, klassiska i
      `com.apple.MobileBluetooth.devices.plist`) och Bakgrund.
    - Android: Om telefonen (`device_name`, `default_device_name`, `android_id`, modell, version, säkerhetsuppdatering
      och bygge ur `build.prop` i system, vendor, product och system_ext), Lägen (flygplansläge, Wi-Fi, Bluetooth,
      mobildata, plats, automatisk tid, utvecklaralternativ, USB-felsökning, okända källor, skärmtid, textstorlek,
      antal starter och tangentbord ur `settings_*.xml`, ABX från Android 12), Wi-Fi (`WifiConfigStore.xml` i text,
      både `misc` och `misc_ce`; lösenordet visas inte, bara att det är sparat), Bluetooth (`bt_config.conf`:
      telefonens namn och adress, och en del per parkopplad enhet), Konton (`accounts_ce.db`) och Bakgrund.
    - Bara det som står i filen visas. En del vars fil saknas står som Inte läst.
  - **Sök**: knappen Sök ovanför dockan, eller att börja skriva på hemskärmen, öppnar sökningen (`renderSearch`,
    `fillSearch`): apparna (hemskärmens, också i mappar, och de med data utanför den, `phoneApps`), kontakterna,
    konversationerna i alla appar (namn, nummer och deltagare, samma som listans sökning, `ChatCore.listView`),
    anteckningarna (inte de låsta), webbhistoriken (titel och adress) och inställningarnas rader (`settingHits`). Det
    som öppnas ur sökningen går tillbaka dit (`fromSearch`). Inställningar har ett eget sökfält för sina rader.
    En chattapps lista har sökfältet överst: namnen och numren filtreras direkt, och med två tecken söks meddelandenas
    text i appens alla chattar (`searchMessages`). Texten läses en gång per konversation med rollen `messages` och
    `ChatCore.conversation` och sparas på databasen (`d.textIndex`, `threadText`); träffarna fylls på medan chattarna
    läses, den senaste först. En träff öppnar chatten vid meddelandet med ordet i chattens sökfält. Escape tömmer ett
    sökfält och går annars tillbaka ett steg.
  - **Appinställningar** (`app-settings.js`, `AppSettings`; `loadAppSettings`, `renderAppInfo`): vad WhatsApp, Signal
    och Snapchat sparat om kontot, sekretessen, meddelandena, säkerhetskopian och länkade enheter. Nås från appens
    lista (Inställningar i appen), Inställningar → Appar och sökningen. Varje rad har fil och fält och är märkt
    **✓ Labb** (kontrollerad i en labb: inställningen ändrades eller händelsen gjordes vid en loggad tid och syntes i
    filen) eller **Ej verifierad** (värdet står i filen, men vad det betyder är inte prövat). Kontrollerat i labb:
    Snapchats Spara till (Android och iOS), Signals länkade enheter på iOS (tabellen `Device`: enhet 1 är telefonen; en
    macOS-dator länkad 2026-11-03, meddelanden från den 2026-11-05) och Signals registreringstid på Android
    (`account.registered_at`, 18:46 inom labbens 18:38–18:47).
    - WhatsApp Android: `com.whatsapp_preferences_light.xml` (läskvitton, `privacy_*` 0 Alla / 1 Mina kontakter / 2 Ingen,
      registrering och senaste inloggning (sekunder), platsdelning, `md_messaging_enabled`), `disappearing_mode_prefs.xml`
      och `backup_prefs.xml`. shared_prefs läses som text eller ABX (`sharedPrefs`).
    - WhatsApp iOS: `group.net.whatsapp.WhatsApp.shared.plist` (`FullUserName`, `OwnPhoneNumber`, `ReadReceiptsOff`,
      `lastAutoBackupDate`, `RestoreBackupDone`). De flesta nycklarna har förkortade namn och läses inte.
    - Signal Android: `signal-key-value.db` (SQLCipher med chattarnas nyckel, `cipherFor`): `settings.*`,
      `phoneNumberPrivacy.*`, `account.registered_at`, `account.has_linked_devices`, `misc.last_foreground_time`.
    - Signal iOS: `keyvalue` i `signal.sqlite` (kolumnerna heter `KEY` och `VALUE` i versaler, så frågorna har alias;
      värdena är NSKeyedArchiver, tal eller text, `keyedValue`) och `Device` (createdAt, lastSeenAt i sekunder; lastSeenAt
      avrundad till dygnet; namnet i klartext för macOS i labbet).
    - Snapchat: Spara till (core.db och primary.docobjects, samma som Härkomst), användar-id
      (`user_session_shared_pref.xml`) och första installationen (`com.toyopagroup.picaboo.plist`).
  - **Kontrollcenter** (Snabbinställningar på Android; `renderControl`, `controlTiles`): Lägen som rutor, på eller av,
    med raden i Inställningar → Lägen bakom varje ruta. Nås med statusraden överst på hemskärmen och låsskärmen
    (`statusBarHtml`: ikonerna för lägena) eller med ett drag nedåt från överkanten: från högra halvan på iPhone (vänstra
    ger notiserna), överallt på Android. Android-lägena har också Mörkt läge (`ui_night_mode`) och Stör ej (`zen_mode`).
    Kontrollerat på labbmobilen 2026-11-20 (Android 13; lägena växlades med `cmd connectivity airplane-mode`, `svc wifi`,
    `svc bluetooth`, `cmd location set-location-enabled`, `cmd uimode night` och `cmd notification set_dnd`, och
    `settings_*.xml` lästes efter varje växling): flygplansläge 0/1; i flygplansläge blir `wifi_on` 3 och `bluetooth_on`
    2 (avslaget av flygplansläget, på efteråt); plats 0/3; mörkt läge 0 automatiskt, 1 av, 2 på, och nyckeln saknas
    tills läget ändrats en gång; Stör ej 0 av, 1 prioriterade, 2 total tystnad, 3 bara alarm. Mobildata gick inte att
    pröva (inget SIM-kort). Raderna i Lägen är märkta på samma sätt som appinställningarna (`checked`); iOS-lägena är
    Ej verifierad tills en iPhone-labb gjorts.
    Signal på Android, samma dag i appen: läskvitton, skrivindikator, förhandsvisning av länkar, skärmskydd,
    inkognitotangentbord, stories av, försvinnande som standard (sekunder: 604800, 2419200) och numrets sekretess
    (`sharingMode` 1 alla, 2 ingen; `listingMode` 0 alla, 1 ingen) ändrades och lästes ur signal-key-value.db direkt från
    telefonen (dekrypterad med databasnyckeln). Skärmlåset kräver telefonens kod och notisernas innehåll kräver
    notistillstånd; de är inte prövade.
    Snapchats spöksläge på Android, samma kväll (Snapchat fick platstillstånd under provet, som drogs tillbaka efteråt):
    databasen `feature`, tabellen `ShareLocationPreferences`. `ghostModeEnabled` 1/0, `ghostModeExpiration` slutet i ms
    (3 timmar efter ändringen, eller 0 = tills det stängs av; tiden står kvar när läget stängs av), `version` = tiden för
    ändringen, `audience` FRIENDS när vännerna ser platsen (NONE på Samsungen 2026-11-11, inte prövat). core.db
    `SnapchatUserProperties` _id 216 fick samma tid men inte läget. Var spöksläget ligger på iOS är inte hittat.
    **Signals PIN på iOS** (2026-11-20, fyndet från MSF-projektet): signal.sqlite, keyvalue, collection `2FA`: `PinCode`
    i klartext (för påminnelserna), `HasEverHadPin` och `LastSuccessfulReminderDate` (unixsekunder). Kontrollerad mot
    iPhone-labbet 2026-11-03: PIN:en i filen är labbens. Android är inte undersökt.
    **Koden till My Eyes Only på Android** (2026-11-20): memories.db, `memories_meo_confidential.hashed_passcode`, en
    bcrypt-hash (`$2a$06$`, kostnad 6) över koden, och `master_key`/`master_key_iv` (huvudnyckeln, krypterad). Raden har
    knappen Pröva alla fyrsiffriga koder (`crackMeo`): `tools/_shared/bcrypt.js` (bcrypt i ren JavaScript, Blowfish med
    pi-decimalerna, kontrollerad mot Pythons bcrypt och OpenBSD:s testvektor) prövar 0000–9999 i flera trådar
    (`Bcrypt.crack`, workers ur en Blob), de vanliga koderna först. 3 ms per kod i en tråd. Kontrollerad på OnePlus-labbet
    2026-11-16: koden hittas och står i labbanteckningarna (facit `meo`, koden står inte i repot). På iPhone finns ingen
    sådan hash i appens filer.
  - **Snapchat Memories på iPhone** (`memories.js`, `Memories`; `loadMemories`, `renderMemories`, `renderMemory`): länken
    Memories i Snapchats lista. Snapsen ur `gallery_data_object/…/scdb-27.sqlite3` (ZGALLERYSNAP, ZGALLERYENTRY:
    tagen, sparad, typ, storlek, längd, My Eyes Only = ZISPRIVATE, tidszon, framkamera, kopia av),
    nyckeln per snap (`snap_key_iv`: 32 byte nyckel, 16 byte iv; `encrypted = 1` = nyckeln krypterad, My Eyes Only),
    positionen och platsnamnet (`snap_location_table`, `snap_address_title`) ur `gallery_encrypted_db/…/gallery.encrypteddb`
    (SQLCipher 3, profilen `snapchat-gallery`, nyckeln `egocipher.key.avoidkeyderivation` i nyckelringen), och filerna
    ur `cache_controller.db` (`CACHE_FILE_CLAIM.EXTERNAL_KEY` = `snap-media-<id>`, `<id>~1` eller `snap-overlay-<id>`;
    filen heter `CACHE_KEY` i `com.snap.file_manager_3_SCContent_…`). Filerna är AES-256-CBC med PKCS7 och snapens nyckel
    och iv (WebCrypto). Overlayn (text och ritning) läggs ovanpå bilden. Visa på kartan skickar minnena med position till
    Positioner med en liten bild, Visa i EXIF och Spara filen tar den dekrypterade filen. Kontrollerat på iPhone-labbet
    2026-11-19: 19 minnen, 17 dekrypterade (15 JPEG, 2 MP4, och 2 overlays i WebP), 2 i My Eyes Only med låst nyckel,
    13 med position (facit `phone`). Fyndet att gallery.encrypteddb går att öppna och att snap_key_iv är nycklarna kom
    från MSF-projektet; att cachens filer dekrypteras med dem prövades här.
  - **En app** visar sina chattar, den senaste först (`appThreads`), 200 i taget. En chatt öppnas i telefonvyn med
    knappen tillbaka (`#c-phone-back`) till appens lista. Att byta till Lista lämnar inte telefonen: där står knappen
    i chattens huvud (`#c-list-back`, `backButtons`). En chatt som öppnas ur listan till vänster medan en chatt visas
    lämnar telefonen (`openThread` ser om telefonen visades när chatten valdes).
  - **Bilder** läser bildbiblioteket med rollen `gallery` (alla rader, med favorit, dold, papperskorgen, slag och
    appen): Photos.sqlite på iOS (bandet efter schemat, `photosBandFromSchema`; iOS 10–13 saknar `ZKIND` och
    `ZKINDSUBTYPE` i schemat från iLEAPP) och MediaStore på Android (`media_type` 1 och 3, med
    `bucket_display_name`). Går rollen inte att köra (en MediaStore före Android 11 utan `is_favorite`) används
    Härkomsts `neighbours`, och det står under Album. `entryKey` kopplar raden till telefonens tumnagel
    (`PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG`) och till filen i zippen; på Android allt under
    `data/media/<användare>/`. Saknas tumnageln förminskas originalet (JPEG, PNG, GIF, WebP, BMP), och en HEIC utan
    tumnagel visas med förhandsbilden i filen (`Heic`).
  - **Album** (flikarna Bibliotek och Album): egna album (iOS: rollen `albums` ur `ZGENERICALBUM`, med bilderna ur
    kopplingstabellen `Z_<n>ASSETS` vars nummer skiljer mellan versioner och som läses ur schemat, `albumLinks`; iOS
    17 har två; Android: mapparna), Mediatyper (videor, skärmdumpar `ZKINDSUBTYPE` 10, skärminspelningar 103,
    favoriter), Sparat av app (`ZIMPORTEDBYBUNDLEIDENTIFIER` eller `owner_package_name`, med appens namn) och Övrigt
    (dolda och Nyligen raderade, rödmarkerade). `galleryGroups`, `filterItems`. Alla urval utom Nyligen raderade
    lämnar papperskorgen utanför, som telefonen; Bibliotek visar allt, med papperskorgen rödmarkerad och de dolda
    märkta Dold. Omslaget är den senaste bilden i urvalet. Ett urval öppnas som galleri med knappen tillbaka till Album.
  - **En bild** öppnas i ett ark med tiderna och källan, och knapparna Visa i EXIF och Bedöm i Härkomst.
    `toExif` skickar filen ur zippen (en krypterad bilaga dekrypterad) med zippens tider som `file-for`, som Härkomst
    gör; förstoringen i en chatt har samma knapp.
  - **Galleriet** (`ChatPhone.Gallery`) ritar bara raderna som syns och en skärm åt varje håll, med en rubrik per
    månad (`layout`, `rowsBetween`). Bilderna läses när rullningen har stannat i 120 ms, högst sex åt gången, och
    högst 400 hålls som blob-adresser (`UrlCache`, aldrig en som syns). Med 20 300 bilder: biblioteket läst på
    0,23 s, första skärmen på 0,5 s och 152 bilder lästa efter en snabb rullning genom 1 200 rader.
  - **En bild** öppnar ett ark med tiden och kolumnen, filen i zippen, var bilden i galleriet kommer från, märkena
    (favorit, dold, skärmdump), papperskorgen, albumen, mappen, appen enligt databasen och källan. Bedöm i Härkomst
    skickar filnamnet dit (`names-for`).
  - Provat 2026-11-19 mot labbtelefonerna: iPhone med iOS 26.4.1 (`Snapchat Laboration`: fyra sidor, mappen Utilities,
    83 Info.plist, två Wi-Fi-nät, tre konton, 56 bilder med albumen Snapchat och WhatsApp ur `Z_33ASSETS`), Samsung A33
    med One UI på Android 16 (två sidor och dockan ur `OneUI.db`, mappen Google, Snapchat och Inställningar på sista
    sidan, ett Wi-Fi-nät, fem konton, 11 bilder i mapparna Camera, Snapchat och Screenshots) och Pixel 9a
    (`launcher_4_by_5.db`, två sidor, modellen ur `vendor/build.prop`). Ingen av dem hade en egen bakgrundsbild, så
    bakgrunden på Android är bara provad i enhetstesterna.
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
  (`2026-11-11 Två telefoner (iPhone och Samsung)/Android/EXTRACTION_FFS.zip`: Android 16, WhatsApp 2.26.43). Katalogen är
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
  (`2026-11-11 Två telefoner (iPhone och Samsung)/Android/EXTRACTION_FFS.zip`: Android 16, Telegram med versionskod 73031 enligt
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

- Ett verktyg för den som gör en egen laboration. Det öppnas sedan 1.68 på **två val** mitt på sidan (`#view-start`):
  **Genomför ny laboration** och **Läs in genomförd laboration**. Mer står inte där: valen är också förklaringen
  av vad verktyget gör. Bakom det första görs ett flöde av steg under **Förbered**, gås igenom med datorns klocka
  under **Genomför**, och blir en tabell till protokollet under **Tabell** (tid, enhet, åtgärd, kod, anmärkning).
  Flikarna för de tre syns bara där. Bakom det andra jämförs loggen med enheternas extraktioner (se nedan).
  `Till start` i rubriken går tillbaka. En laboration som pågår öppnas direkt i Genomför. Ingenting lämnar datorn,
  och en extraktion läses bara.
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
    `addNote` sparar anteckningen med tiden då den började skrivas och steget den gäller (`step`, annars steget
    på skärmen, `currentStep`), och `rows` skriver den i stegets anmärkning. Något som gjordes på en enhet utöver
    flödet (`device`) får en egen rad.
  - **Tabellen**: `rows` ger raderna i den ordning de gjordes (ett överhoppat eller ogjort steg står som
    `inte utförd`), `facts` uppgifterna ovanför, `protocol` tabellen som HTML med inline-stilar (Word gör en tabell
    av den vid inklistring, och samma HTML skrivs ut) och som text med tabbar, och `toCsv` en fil med semikolon,
    BOM och en UTC-kolumn. Datumet står på varje rad bara när laborationen går över midnatt.
  - **Filen** (`toFile`/`fromFile`): JSON med `format: "forensics-toolbox-laboration"`, flödet och, om det finns,
    körningen. Samma fil är alltså både ett flöde att dela och en logg att öppna igen. `fromFile` städar varje fält
    som när det skrevs in och kastar det som inte hör till formatet. De egna mallar som flödets grupper kom ur
    följer med som `mallar`, och läggs under Mina mallar hos den som öppnar filen. Alla egna mallar sparas som en
    egen fil med `templatesToFile` (`format: "forensics-toolbox-laboration-mallar"`), och `Öppna` tar båda slagen.
- **Startsidan** (1.74) har en sökruta bland flödena att utgå från: de färdiga (`READY` och `readyFlow` i
  `lab-core.js`, byggda ur mallarna), de egna mallarna och de senast genomförda (`localStorage['ft-laboration-senaste']`,
  högst sex, sparade när en laboration startar). Ett kort visar stegen i en förhandsvisning innan det används. Där
  finns också ett tomt flöde, guiden **Bygg från delar** (`#view-wizard`: enheter, appar, delar, och sedan
  `buildFlow`) och inläsningen av en genomförd laboration. De färdiga flödena är 13 sedan 1.75, och 14 med *Radera bilder och Secure Folder (Samsung)*. Ett flöde med en egen
  grupp (`own`) anger enheterna med plats i listan: `on` gör steget och `with` är motparten.
- **Mina laborationer** (1.75, `#s-mine`) står först på startsidan: laborationen i verktyget (`#s-current`, märkt
  Öppen, den som flikarna gäller) och de undanlagda (`#s-shelf`), med status Förberedd, Pågår eller Klar. Ett nytt
  flöde, eller en logg som öppnas i Förbered, lägger undan den som finns (`park()`) i stället för att ersätta den.
  Öppna byter plats på dem (`openParked`). De undanlagda ligger i `localStorage['ft-laboration-sparade']`, `{ id,
  at, file, setup }` per laboration, med samma filformat som loggen, och listan läses om varje gång startsidan ritas.
  Ta bort frågar först.
- **Förbered är en byggare** i tre kolumner (1.74): byggstenarna till vänster, flödet i mitten och det valda till
  höger (`#p-detail`). **Det valda** (`state.sel`, `{ step }` eller `{ group }`) är också märket: nästa byggsten
  hamnar efter det valda steget, sist i den valda gruppen, och utan val sist i flödet (`mark`). En mall blir alltid
  en egen grupp efter gruppen vid märket. Ett klick på en byggsten och ett släpp efter ett drag går genom samma
  `place(kind, id, plats)`. Ett eget steg läggs in direkt och skrivs i rutan till höger. Rutan ändrar steget eller
  gruppen medan man skriver (`editStep`, `editGroup`); det som skrivs i ett fält är en ändring för Ångra tills fokus
  lämnar det. Under 1180 px ligger rutan över flödet när något är valt. Namnet, enheterna (märken som byter namn på
  plats) och menyn **Mer** (filerna, utskriften, kodbokstaven och Rensa allt) står ovanför flödet.
- **Dra och släpp** görs med pekarhändelser (`onPointerDown`, `targetAt`, `showLine`, `drop`), så att det fungerar
  med mus, penna och finger: greppet på ett steg eller en grupp, och en byggsten ur listan med mus eller penna. En
  linje visar var det hamnar, och flödet rullar nära kanterna. Mallar och grupper släpps mellan grupper, steg var
  som helst. Tangenterna gör samma sak: Alt+↑ och Alt+↓ flyttar det valda, Delete tar bort det, Esc tar bort valet.
  Röktestet drar med `pointerDrag` i `tests/app/cdp.js`.
- **Ångra**: varje ändring av flödet går genom `change(fn)`, som först sparar flödet som text (högst 50 steg
  bakåt). `fn` som svarar `false` ändrade ingenting, och då sparas inget. Knappen Ångra och Ctrl/Cmd+Z (inte i
  ett textfält) tar tillbaka den senaste. Historiken töms när laborationen börjar och när en fil öppnas.
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
  `Avbryt laborationen` under Genomför och `Ny laboration med samma flöde` under Tabell tar bort körningen och
  låser upp (`dropRun`). Flödet står kvar i båda fallen.
- **Genomför** (1.65): koden, klockan och datumet med zonen står i en ram, `#r-shot` ("Rutan att fotografera"), så
  att bilden inte behöver visa hela skärmen. Stegens texter säger "rutan med koden och klockan"; ett flöde som
  sparades före 1.65 behåller sina gamla texter. Listan med stegen till höger (`#r-list`) har 14 px text, är mellan
  340 och 560 px bred och visar det aktuella stegets hela text. Under 700 px bredd ligger delarna under varandra
  och vyn rullar. `Avbryt laborationen` (`#r-abort`) finns bara när laborationen har börjat, frågar först och har
  ingen tangent, så att den inte trycks av misstag. Efter det sista steget visas Tabell av sig själv (`finish()`); en
  väntan efter det sista steget räknas först ner, och V avbryter den. Överst i Tabell står det som är kvar i ordning:
  spara loggen, lägg tabellen i protokollet och analysera mot extraktionerna (`renderNext`). Den första knappen som inte
  är gjord är blå. `Fel tryck? Ångra det sista` (`#t-undo`) finns bara direkt efter det sista steget och går tillbaka
  till Genomför. `Rensa allt` (`#p-reset`) överst under Förbered tar bort namnet,
  enheterna och stegen (`fresh()`), och loggen om det finns en. De egna mallarna ligger kvar.
- **QR-koden i rutan** (1.68, `qr-encode.js`, `LabQr`, utan DOM, testad i `qr-encode.test.js` genom att koden läses
  tillbaka med `tools/QR2URL/jsQR.js`). Bredvid koden och klockan i `#r-shot` står en QR-kod med texten
  `LabCore.shotText(kod, t)`: stegets kod och klockan i hela sekunder (`L03 1794481380`). Den ritas om när sekunden
  byts och finns bara medan ett steg pågår. Med ett prefix i A–Z har texten bara versaler, siffror och mellanslag och ryms
  då i den minsta QR-koden (version 1, 21 × 21 rutor), så att rutan kan vara liten: koden är högst 140 px bred på
  skärmen. Ett prefix med Å, Ä eller Ö skrivs som byte och ger en något större kod.
  `LabCore.readShot` läser texten tillbaka. Kodaren kan bara det som behövs här: version 1–6 och felrättning M.
- **Läs in genomförd laboration** (1.68, `#view-trace`): loggen (verktygets egen efter en laboration, eller den sparade
  filen), en extraktion per enhet, och en tabell där varje steg står med loggens tid, telefonens tid och källan.
  Tre filer:
  - `lab-read.js` (`LabRead.read(file, o)`) läser en extraktion till **underlaget**: meddelanden (bara koderna som
    står i texten, tiderna och det som öppnar raden i Queries; texten sparas inte), bildbibliotekets filer från
    laborationen med QR-koden ur bilden och en liten bild att välja efter, och lås, av och på och app i förgrunden
    ur loggarna som Härkomst läser (knowledgeC på iOS, usagestats på Android). Databaserna hittas och läses genom
    katalogernas roller, som i Chattar och Härkomst, och stängs när de är lästa. Bara chattar med meddelanden från
    laborationens dygn (ett dygn åt vardera hållet) läses, och antalet står i kortet. Svaret säger också vad som
    lästes (`read`) och vad som inte lästes och varför (`missing`); båda visas. QR-koden söks med jsQR först i en
    förminskad bild och sedan i hela, på iOS också i telefonens JPEG-kopia (`5005.JPG`) av en HEIC-bild eller video.
    Extraktionerna läses en i taget, och allt hålls i minnet.
  - `lab-trace.js` (`LabTrace`, utan DOM, testad i `lab-trace.test.js`) jämför. `match(flow, run, evidence, { before,
    after, chosen })` söker **koden först** (i meddelandets text, i gruppens namn eller i QR-koden i bilden) och
    **tiden sedan** (ett spår av rätt sort från `before` sekunder före till `after` sekunder efter loggens tid; 180
    och 60 från början, och båda står i fält ovanför tabellen). Märkena (`MARKS`) är **säker** (koden står i spåret),
    **trolig** (det enda spåret av rätt sort i tiden), **flera möjliga** (det närmaste är föreslaget och användaren
    väljer; valet ger **vald**), **inte hittad**, **söks inte** och **ingen extraktion**. Ett spår som bara hittas
    på tiden är aldrig säkert. Ett chattsteg söks i båda enheterna: skickat hos den som gör steget, mottaget och
    läst hos motparten. En app utan eget stöd söks som app i förgrunden på namnet i paketets id (`APP_IDS`).
    Flygplansläge, installation och avinstallation söks inte, och inte av och på i iOS.
  - **Klockorna**: en bild där QR-koden går att läsa bär både datorns sekund och telefonens tid för bilden.
    Skillnaden är telefonens klocka mot datorns (`clocks`), och står i uppgifterna ovanför tabellen med antalet
    bilder. Bara sådana bilder räknas, och tabellens tider rättas inte efter den. Uppgiften bredvid, hur långt
    efter telefonens tid trycket kom, är medianen i de säkra stegen.
  - `trace-view.js` (`LabTraceView`) ritar. Tabellen på skärmen har fem kolumner (Kod, Steg, Loggens tid,
    Telefonens tid och källa, Märke) med fasta bredder, så att den aldrig rullar i sidled. `Mer` på en rad visar
    spårets alla tider med kolumnernas namn. Märkena ovanför tabellen är också filter. **Källan** är en länk som
    öppnar samma query med samma värden i Queries och märker ut raden på tiden (`open-query` till ramen; öppnas
    verktygets sida för sig, utan ramen, står källan som text).
  - **Till Word** går `LabTrace.protocol`: fem kolumner (Kod, Åtgärd, Loggens tid, Telefonens tid, Källa) med
    inline-stilar. Mer än fem kolumner blir för brett på ett stående A4. Allt annat står i CSV-filen (`toCsv`, tolv
    kolumner med UTC-tider, märke och hur långt efter trycket kom). Kopian, utskriften och filen tar hela listan,
    inte bara det märke som visas.
  - Den öppnade loggen hålls för sig (`view.log`) och rör inte verktygets eget flöde.
  - Jämförelsen är inget facit av sig själv: den säger var programmet hittade steget. Mot det handgjorda underlaget
    från laborationen med två telefoner (`tests/app/facit/lab-tva-telefoner.json`) gav den, i Node och genom
    appen: av 75 steg 28 säkra, 36 troliga, 8 med flera möjliga, 2 inte hittade och 1 som inte söks. Inget test i
    repot läser det underlaget än; röktestet går mot en påhittad extraktion (`tests/app/lab-trace-fixture.js`).
- Electron har ingen `window.prompt`, så egna steg och anmärkningar skrivs i formulär i sidan. Utskriften går genom
  en dold ram (`#l-print`, `srcdoc`), så att bara tabellen skrivs ut.
- Inte prövat: utskriftsdialogen i appen och inklistring i Word. Kopieringen är prövad i Chrome med ett riktigt
  musklick (HTML och text i urklipp). QR-koden är läst tillbaka av jsQR från skärmen och ur en ritad bild i en
  påhittad extraktion, men ingen riktig telefon har fotograferat den än.

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

### Samsungs Rubin (`queries/android/samsung/`, SQLCipher-profilerna `rubin-logging` och `rubin-monitoring`)

- **Var och hur:** `data/data/com.samsung.android.rubin.app/databases/`. De flesta databaserna är krypterade med
  SQLCipher 2: PBKDF2-HMAC-SHA1 i 4000 varv, HMAC-SHA1, sidor om 4096 byte (reserv 48). Lösenordet är värdet `Logging`
  eller `Monitoring` för `com.samsung.android.rubin.app` i `extra/Secrets/secrets.json`, 256 byte som hex, och används
  som byte (`passIsHex`), inte som text. Kontrollerat mot Samsung A33 (Android 16) 2026-11-19: `Logging` öppnar
  `inferenceengine_logging.db` och `Monitoring` `inferenceengine_monitoring.db`, HMAC stämde för alla sidor. Rubins andra
  krypterade databaser (`odm.db`, `poi.db`, `pim.db`, `context_fence_database.db` och fler) öppnas inte med någon av dem.
  `AppSecrets.fromSecretsFile` sparar nycklarna under `named`, och `keysForProfile` ger rätt nyckel för profilen.
- **Rollback-journal:** Rubin har en tom `-journal` i stället för `-wal`. `ExtractionCore.describe` varnar då inte för
  att `-wal` saknas; en `-journal` med innehåll ger som förut båda varningarna.
- **I Queries:** två databaser i Samsung-gruppen. Logging: Händelser i tidsspann (app_usage, screen_state_log,
  setting_change, location_log, wifi_connection_log, all_bluetooth_log med namnen ur all_bluetooth_dictionary, charging_log
  och motion_log i en tidslinje), Appar i förgrunden, Positioner, Ändrade inställningar, Wi-Fi, Bluetooth och laddning,
  Appar som frågade Rubin (api_call_log) och Hur långt loggen räcker. Monitoring: Platser och sammanhang (hemma eller
  borta, platsens slag, tpo_context_event och gång med telefonen i handen), som är Rubins slutsatser och inte mätningar.
- **I Härkomst** (`addRubin`): `location_log` i fönstret blir telefonens positioner i faktorn Position (märkta Rubin och
  källan, till exempel passive_network), och `app_usage` blir appintervall bredvid usagestats, SSRM och batterihistoriken.
  Täckningen står i protokollet. Utan nyckel sägs det bland varningarna.
- **Hur långt det räcker:** Rubin rensar gamla rader. I labbtelefonen räckte `app_usage` bara 2026-09-30 och
  `location_log` hade tre rader, alla från extraktionsdagen; `setting_change` hade 54 och `api_call_log` 113. Samsung-labbets
  facit (15 delar) gav samma svar med Rubin som utan.

### MediaStore: ursprung och ordning (`queries/android/catalog.json`, kategorin mediastore)

- **`generation_added`** (Android 11 och senare) är en räknare som bara ökar när en fil registreras, oberoende av
  klockan. Ordningen gäller också när en tid är fel. **`download_uri` och `referer_uri`** (Android 10) säger varifrån en
  nedladdad fil hämtades och från vilken sida. **`deleted_files`** (Android 14; `_id`, `media_type`, `deleted_generation`)
  och **`deleted_media`** (Android 12; `old_id`, `generation_modified`) har de poster som tagits bort, utan namn.
- **Queries:** Nedladdade filer och varifrån de kom, Ordningen filerna kom in (med `tid_bakat` när `date_added` går bakåt
  mot filen innan), Filerna före och efter en fil (de tio närmaste åt varje håll, och raderade poster mellan dem),
  Raderade poster (med filen som kom in närmast före), Papperskorgen med utgångsdatum och XMP i bilderna.
- **Härkomst:** rollen `media-origin` (en egen fråga, så att en äldre databas bara saknar faktorn) ger faktorn
  **Sammanhang i bildbiblioteket** (`factorContext`), alltid en upplysning: nedladdningen med adress, sida och app,
  filens nummer i ordningen med de tre närmaste före och efter, antalet raderade poster mellan dem, och om filens tid går
  bakåt mot filen före den i ordningen (mer än 2 s): då är filens tid inte när den kom in.
- Labbtelefonen (Samsung A33, Android 16): 92 rader i `files`, F-Droid nedladdad från f-droid.org med Samsungs
  webbläsare, tio raderade poster, och kamerabilden 20261106_145905.jpg nummer 675 efter två Molly-säkerhetskopior.

### Anteckningar (`tools/_shared/notes.js`, `Notes`; `queries/notes/`)

Apples Anteckningar (`NoteStore.sqlite` i appgruppen `group.com.apple.notes`) och Samsung Notes
(`com.samsung.android.app.notes/databases/sdoc.db`). Byggt 2026-11-19 mot labbtelefonerna: iPhone med iOS 26.4.1 (en
anteckning i iCloud) och Samsung A33 (två anteckningar). Låsta, raderade, checklistor och bilagor är bara provade med
påhittade databaser i telefonernas schema (`notes.test.js`, röktestets testzippar).
- **Texten på iPhone:** `ZICNOTEDATA.ZDATA` är gzip med protobuf: 2 dokument → 3 anteckning → 2 texten och 5
  formateringen i körningar (1 längd i UTF-16-tecken, 2 styckeformat med 5 checklista där 2 är avbockad, 9 länk, 12
  bilaga med 1 id och 2 typ). Checklistans rader får ☐ eller ☑ först. En bilaga står som U+FFFC i texten; namnet tas ur
  ICAttachment (`ZIDENTIFIER`, `ZTYPEUTI`) och ICMedia (`ZFILENAME`). Uppackningen är synkron (`tools/_shared/inflate.js`,
  DEFLATE med gzip- och zlib-huvud, testad mot Nodes zlib), eftersom Queries avkodar medan databasen öppnas.
- **Kolumnerna** i `ZICCLOUDSYNCINGOBJECT` skiftar mellan iOS-versionerna och väljs efter schemat: titeln `ZTITLE1`,
  skapad `ZCREATIONDATE3` (äldre `ZCREATIONDATE1`), ändrad `ZMODIFICATIONDATE1`, mappen `ZFOLDER` med `ZTITLE2` och
  `ZFOLDERTYPE` (1 Nyligen raderade), kontot genom mappens `ZOWNER` (annars den `ZACCOUNTn` som pekar på ett konto).
  Entiteterna (ICNote, ICFolder, ICAccount, ICAttachment, ICMedia) tas ur `Z_PRIMARYKEY`.
- **Låst** (`ZISPASSWORDPROTECTED`): texten är krypterad med anteckningens lösenord och avkodas inte; titeln, tiderna och
  `ZPASSWORDHINT` syns. **Raderad:** i Nyligen raderade, eller `ZMARKEDFORDELETION` 1.
- **Samsung Notes:** `content` är texten som UTF-8, `createdAt`/`lastModifiedAt` millisekunder i UTC, `categoryUUID`
  mappen i `category_tree` (`trash:///` är papperskorgen), `recycle_bin_time_moved` när den flyttades dit, `isLock` och
  `isFavorite`. Hela anteckningen (bilder, handskrift) ligger i `.sdocx`-filen som `filePath` pekar på, och läses inte.
  En tom titel blir första raden, som i appen.
- **Queries:** Apples anteckningar avkodas när databasen öppnas till tabellerna `anteckning` och `anteckningsmapp`
  (`Notes.attach`, som Telegrams `tg_`-tabeller; `attachDerived` i `run.js` och `rank` i `identify.js` provar båda).
  Samsung Notes läses direkt med SQL. Underrubriken Anteckningar (beta) under iOS och Android.
- **Telefonen:** appen Anteckningar (`com.apple.mobilenotes`, `com.samsung.android.app.notes`) har en rubrik per mapp
  med de raderade sist, fästa först och sedan den senast ändrade, urvalen Alla, Låsta och Raderade, och en vy per
  anteckning med texten, tiderna, mappen, låst och raderad med fälten de kommer ur, och raderna i databasen.
- **Inte byggt:** Google Keep (ingen extraktion med `keep.db`), bilagornas bilder, `.sdocx`-filernas innehåll och
  äldre iOS-anteckningar i `notes.sqlite` (före iOS 9).

### Meddelanden, samtal och kontakter (`queries/comms/`, `tools/_shared/comms.js`, `Comms`)

Telefonens egna appar, byggda 2026-11-20 med queries först: katalogen `COMMS_CATALOG` har de synliga frågorna i
Queries (Meddelanden, samtal och kontakter, beta) och dolda roller som Chattar och Telefonen läser.
- **Databaserna:** `sms.db` (iOS), `mmssms.db` (Androids SMS-leverantör, `user_de/0` eller `data/data`), `bugle_db`
  (Google Meddelanden), `CallHistory.storedata`, `calllog.db`, `AddressBook.sqlitedb` och `contacts2.db` (AOSP och
  Samsungs `com.samsung.android.providers.contacts`). Tabellerna (bara CREATE TABLE) ligger i
  `tools/db-queries/fixtures/comm-schemas.json`: labbiPhonen (iOS 26.4.1) och Samsung A33 (Android 16).
- **Provat mot riktiga data:** iPhone-labbet (3 SMS, 21 samtal i Signal, WhatsApp och Telegram, 3 kontakter), en
  iOS 18.7-extraktion (iMessage med två bilagor vars sökvägar finns i zippen) och Google Meddelanden i Samsung-labbet
  (14 meddelanden, `sms_message_uri` pekar på rader som saknas i den tomma `mmssms.db`). `mmssms.db`, `calllog.db` och
  `contacts2.db` var tomma i alla Android-extraktioner: de frågorna är bara provade mot schemat och testets rader.
- **sms.db:** tiderna är Cocoa-nanosekunder (äldre: sekunder), epoken `cocoaAuto` i `roles.js` och `run-core.js`.
  Texten står i `text` eller bara i `attributedBody` (typedstream): SQL:en läser strängen efter `NSString` och `+`, med
  längden i en byte eller `0x81` och två byte, och tar bort U+FFFC. Nyligen raderade:
  `chat_recoverable_message_join` (med `delete_date`) i stället för `chat_message_join`; `date_retracted` (ångrat),
  `date_edited`, `deleted_messages`. Chattrollerna kräver iOS 16 eller senare. Bilagorna: `~/Library/SMS/Attachments/…`
  med `fileRoot` `../..`.
- **mmssms.db:** SMS och MMS i samma tråd med nycklarna `s<id>` och `m<id>`; MMS-texten ur `part`, avsändaren ur `addr`
  (137), bilagan i `app_parts/`. **bugle_db:** `message_status` under 100 utgående, 100–199 inkommande, 200 och högre
  händelser i appen; motparter har `sub_id` -2. Bilagornas filer är inte kopplade (sökvägen inte kontrollerad).
- **Samtal** (roll `calls`): riktningen som `in`, `out`, `missed` med flera; på iOS appen ur `ZSERVICE_PROVIDER` utan
  utvecklarens prefix och fler deltagare ur `Z_2REMOTEPARTICIPANTHANDLES`. För appar är `ZADDRESS` appens id för
  motparten. **Kontakter** (roller `contacts` och `contact-points`): en rad per kontakt (Android per `contact_id`, med
  kontona) och en per nummer eller e-post. Queries visar också `ABPersonChanges`, sökindexets rester och
  `deleted_contacts`.
- **Namnen:** `Comms.phoneKey` jämför de nio sista siffrorna (e-post med gemener). Chattar läser kontakterna före
  konversationerna (`loadComms`), och `ChatCore.applyContacts` ger deltagare, enskilda chattar och avsändare som bara
  har ett nummer kontaktens namn; ett namn som appen själv har behålls.
- **Telefonen:** Meddelanden (`com.apple.MobileSMS`, Google och Samsung Meddelanden) är en chattapp. Telefon visar
  samtalen per dag med urvalen Alla, Missade och I appar, och ett samtal med fälten det kommer ur, kontakten och
  chattarna med numret. Kontakter visar kontakterna efter bokstav, och en kontakt med nummer, konto, tider, samtalen och
  chattarna.
- **Inte byggt:** Samsung Meddelanden (`message_content.db`), `calls` i `contacts2.db` före Android 7, iOS 15 och äldre
  i Chattar, och redigeringshistoriken i `message_summary_info`.

### Webbhistorik (`queries/web/`, `tools/_shared/web.js`, `Web`)

Byggd 2026-11-20 med queries först: `WEB_CATALOG` har frågorna i Queries (Webbhistorik, beta) och dolda roller
(`web-visits`, `web-searches`, `web-downloads`, `web-tabs`, `web-cleared`) som Telefonen läser. Generatorn ligger
inte i repot; katalogen ändras direkt i `catalog.json` och synkas till `catalog.js` med `npm run sync-queries`.
- **Databaserna:** Safaris `History.db`, `SafariTabs.db` och `Bookmarks.db` (`/private/var/mobile/Library/Safari/`),
  Chromes `History` (`app_chrome/Default/History`, samma fil i Edge, Brave och andra Chromium-webbläsare), Samsung
  Internets (`app_sbrowser/Default/History`) och Chrome på iPhone (inte provad). Tabellerna (bara CREATE TABLE) i
  `tools/db-queries/fixtures/web-schemas.json`: iPhone-labbet (iOS 26.4.1) och Samsung A33 (Android 16).
- **Provat mot riktiga data:** Safari i en iOS 18.7-extraktion (11 besök, 4 sökningar, 3 flikar med tid), Chrome i en
  Pixel (14 besök) och i Samsung-labbet, och Samsung Internet i Samsung-labbet (7 besök och en nedladdning).
- **Safari:** tiderna är Cocoa-sekunder. `history_visits.origin` 0 är den här enheten och 1 ett besök synkat genom
  iCloud (inte prövat i labbet). `redirect_source`/`redirect_destination` är besökens id. `history_tombstones` är
  spåren efter rensad historik (spannet, och adressen när en sida togs bort). Söktermerna läses ur adressen (`q=`,
  Yahoo `p=`); SQL:en avkodar de vanligaste procentkoderna i steg om sex `replace()` (sql.js tål inte djupare
  nästling), och `Web.decodeTerm` avkodar resten i Telefonen.
- **Flikarna (`SafariTabs.db`):** flikar är `bookmarks` med `type` 0 och en adress, flikgrupper `type` 1. `windows`
  säger vilken grupp som är de vanliga (`local_tab_group_id`) och de privata (`private_tab_group_id`). Tiden står i
  plisten `local_attributes` (`LastVisitTime`), som Telefonen läser med `KC.bplist`.
- **Chromium:** tiderna är mikrosekunder sedan 1601 och räknas om till Unix-millisekunder i SQL:en (`/ 1000 -
  11644473600000`), så rollerna har epoken `unixMs`. `transition & 255` är övergången, de höga bitarna tillägg
  (adressfältet, från en app, bakåt/framåt, omdirigering). `originator_cache_guid` är satt för synkade besök.
  Nedladdningens adress är den sista i `downloads_url_chains`; på Android står ofta MediaStores adress
  (`content://media/external/downloads/<id>`) som sökväg, och då tas filnamnet ur adressen.
- **Telefonen:** `loadWeb` läser databaserna efter samtalen, en post per webbläsare (`Web.browserOf`: paketet i
  sökvägen på Android, Safari och Chrome på iPhone; användare 0 först). Webbläsaren öppnas från sin ikon på
  hemskärmen (eller sista sidan) med flikarna Historik, Sökningar, Nedladdningar, Flikar och Rensat, och varje rad
  har en detalj med fälten och källan.
- **Härkomst (upplysningen Webbläsaren, `web-origin.js`, `ProvenanceWeb`):** webbkällorna samlas av
  `ProvenanceRoles.collect` (`web: true`), och `webOrigin` i Härkomst letar för filen:
  - Android: nedladdningen i en Chromium-webbläsare vars `target_path`/`current_path` är filens post i MediaStore
    (`content://media/external/downloads/<_id>`; alla samlingar är vyer av `files`, så numret är filens `_id`), annars
    samma sökväg i den delade lagringen (`tail`), annars samma namn med slut inom tio minuter från `date_added`
    (märks som osäker).
  - iOS: en bild som Safari eller Chrome sparade i bildbiblioteket (`ZIMPORTEDBYBUNDLEIDENTIFIER`). Safari sparar
    inte källan, så bara besöken före visas. Hämtningar i Safari (`Downloads.plist`) läses inte än.
  - Besöken de tio minuterna före (högst fem). Upplysningen väger inte och visas också när filen saknar skapandetid.
  - Prövat i Samsung-labbet: F-Droid.apk kopplas till Samsung Internets nedladdning genom MediaStores post 24.

### Raderade bilder och Secure Folder (`queries/android/samsung/`, `android-users` i `queries/system-logs/`)

Byggt 2026-11-19 utan rader att kontrollera mot: tabellerna finns i alla tre Samsung-zipparna (A33, tvåtelefonslabbet
och Solflare) men är tomma, och ingen har användare 150. Flödet *Radera bilder och Secure Folder (Samsung)* i Laboration
är labbet som ska ge facit.
- **`samsung-trash`** (`com.samsung.android.providers.trash/databases/trash.db`, tabellen `trashes`): Samsungs gemensamma
  papperskorg med `original_path`, `date_deleted`, `date_expires`, `delete_package_name`, `user_id` och
  `original_file_hash`. *Hur många som någonsin lagts i papperskorgen* jämför `sqlite_sequence` med raderna nu. Tiderna
  räknas som sekunder eller millisekunder efter storleken, eftersom enheten inte är känd. I tvåtelefonslabbet är
  `-wal`-huvudet nollställt, och Queries lägger inte på den.
- **`samsung-gallery-local`** (`com.sec.android.gallery3d/databases/local.db`): Galleriets `trash`, `recover`,
  `operation_history` och `log`. Loggens kategorier är tolkade efter triggerna (1 decoding, 2 delete högst 500 rader,
  3 version, 4 mde, 5 generic, 9 ppp). Labbtelefonen har 29 rader, ingen i kategori 2.
- **`android-users`** (tolkningen `android-users` i `text-logs.js`, mappen `data/system/users/`): `userlist.xml` och
  `<id>.xml` (ABX eller text) och Samsungs `persona_cache.xml`. Slaget räknas efter typen, och på Samsung efter id
  (150–160 Secure Folder, 95 Dual Messenger, inte kontrollerat). `nextSerialNumber` över 10 betyder att användare har
  skapats, också borttagna. `USER-REMOVED` i `persona_cache.xml` med `fallbackToSingleUserLP` 2022 på A33:an är en
  återställning till bara ägaren. Undermapparna (`0/` med inställningar) läses men används inte.
- **Andra användares databaser:** `locate.js` ger redan `/data/user/<id>/` som egna träffar. Queries skriver nu
  *Secure Folder på Samsung* vid användare 150–160 (`userNote` i `extraction.js`).

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
  - *Antagen zon:* säger ingen logg zonen (SSRM utan `[RTC]`, en batterifil utan ändringstid i UTC i zippen och utan SSRM att luta sig mot) räknas raderna med telefonens inställda zon som antagande (`batteryZones` ger `assumed`, `collect` räknar `assumed` och `assumedZone`). De går till `unsure` med `assumed`, blir händelser av slaget `log-unsure` med texten "zonen antagen: <zon>", och räknas inte: ingen faktor blir Förenligt eller Inte förenligt av dem, och de ritas inte i tidslinjen. Faktorn som saknar underlag får en upplysning med vad raderna säger kring T och att zonen ska kontrolleras (`unsureItems`), och en varning säger antalet och zonen. Täckningen och strömläget byggs inte på antagandet: `ssrmCoverage` och `batteryCoverage` ger `noZone`, och skälet säger då att loggen inte går att lägga i tiden i stället för att den inte har något vid tidpunkten. Så blir en rad som saknas under en antagen zon aldrig ett besked. Utan `persist.sys.timezone` används raderna inte alls (`noZone`, varningen säger det). Bildens egen zon i EXIF används inte som källa: den finns bara i kamerabilder, och filen är det som bedöms. Provat 2026-11-13 med påhittade loggar (`Testextraktion-Samsung-utan-zon.zip` i provkörningen), inte med en riktig extraktion där zonen saknas.
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
går i JavaScript och WebAssembly. Jobbet stoppar inte releasen. Sedan 2026-11-19 körs allt det bara med "Run workflow"
och edge = alla (cirka en timme). Vid en push körs bara den fristående filen med `IntranetFileLinksEnabled`, eftersom
det är den som används på datorer där Edge inte visar html-versionens verktyg.

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

#### Notiser och Biome

- **Varför:** en notis från en chattapp strax före en fil stöder att filen togs emot, inte skapades. Och den
  visar att telefonen var igång, också med släckt skärm. Notisen ensam säger inte att någon använde telefonen.
- **Android:** usagestats typ 12 `NOTIFICATION_INTERRUPTION` (notisen gav ljud, vibration eller en ruta) och 10
  `NOTIFICATION_SEEN` (notiserna visades för användaren). Där finns bara paketet och kanalen (`usageNotifications`,
  fält 9 i version 5 och fält 12 i version 4), ingen text. Raderna försvinner när appen avinstalleras.
  - **Labbet 2026-11-16 (webb1):** snapsen från Snapchat för webben gav typ 12 kl. 22:10:37 och 22:10:40 UTC,
    med kanalerna `general_group_silent` och `general_group_generic_push_noisy…`. Skärmen tändes 3 s efter
    notisen, och typ 10 kom efter ytterligare 1 s.
  - Android 13 har ingen `notification_log.db`.
- **iOS:** Biome-strömmen `Notification.Usage` i `Library/Biome/streams/restricted/<ström>/local/`.
  - **Filerna (`biome.js`, `ProvenanceBiome`) är SEGB:**
    - **Version 2** (iOS 17 och senare): ett huvud på 32 byte (`SEGB`, antal, skapad). Posterna (crc32, 1, data)
      ligger efter varandra med 4-byteskant, och listan (slut relativt huvudet, läge, tid) står baklänges i
      slutet av filen.
    - **Version 1** (sett på iOS 18.7): slutet på datat först och `SEGB` på plats 52. Varje post har ett
      huvud på 32 byte: längd, läge, två tider och crc32.
    - Läge 1 är skriven och 3 rensad, och då är datat nollat. Tiderna är Mac-sekunder.
    - Filens namn är när den skapades, inte vilka tider den har. En fil från 2025 hade poster från oktober
      2026, så alla filer i strömmen läses.
    - Bara `local/` läses. `remote/<enhet>/` kommer från andra enheter på kontot, och `tombstone/` säger bara
      vad som rensats.
  - **Fälten i `Notification.Usage`:**
    - 2 är notisens tid, samma för alla händelser kring notisen.
    - 3 är händelsens typ, 4 appen, 5 notisens id och 8 titeln. För Snapchat är titeln avsändarens namn.
    - Postens tid är händelsens tid.
    - Typ 17 kommer inom någon sekund efter notisens tid. De andra typerna (0, 7, 11, 18, 19) är inte
      kontrollerade, så de tolkas inte.
    - iOS skriver ofta samma notis under två id med samma tid och titel (en med 17, 7 och 19, en med 18 och
      11). `notifications()` räknar dem som en.
  - **`App.InFocus`:**
    - 3 är 1 när appen kommer i förgrunden och 0 när den lämnar den, 4 är tiden och 6 appen.
    - 1 är skälet (`transitionReason`), och 2 är sorten: 1 en app, 3 kontrollcentret och liknande.
    - Händelserna går genom `intervalsFromEvents` som 1 och 2.
    - Appen läggs bara till när knowledgeC saknar `/app/usage` i fönstret, och då före PowerLog.
  - **Kontrollerat mot:** iOS-labbzippen (26.4.1, version 2) och en iOS 18.7-zipp (version 1). Alla skrivna
    poster hade rätt crc32.
- **Härkomst:**
  - `input.notifications` blir händelser med `kind: 'notification'` och `lane: 'notice'`, och en egen rad
    Notiser i tidslinjen (romb för notisen, ring för visad).
  - Androids egna notiser (paketet `android`) och visade notiser får ingen mening i förklaringen.
  - *App igång* får en upplysning om appen visade en notis högst 2 min före T. Det gäller bara när filen kan ha
    kommit utifrån (`noticeMatters`), alltså inte kamerabilder, skärmdumpar eller Snapchats egna tagningar.
- **Queries:**
  - Katalogen `queries/system-logs` har en databas per mapp (`folder: true`, sökvägen slutar med `/`).
  - `locate.js` gör mappen till en träff med alla filer under den. `ExtractionCore.zipSource` läser dem, och
    varje fil står med CRC32 och SHA-256.
  - `text-logs.js` lägger raderna i tabellerna `handelser` (usagestats), `notishandelser` och `forgrund` (Biome).

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
- **CSV:** alla CSV-exporter (Queries, EXIF, Positioner, App-id) sätter en apostrof före en cell som
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

**En ny Perl-instans för varje fil (1.65).** Biblioteket sparar sin Perl-instans i en `WeakRef` och använder den
tills skräpsamlaren har tagit den. I en och samma instans blev varje läsning omkring 1 ms långsammare än den förra,
minnet växte med omkring 9 MB per läsning, och efter ungefär 230 läsningar slutade varje läsning med "memory access
out of bounds". Bygget byter därför två saker i bibliotekets kod med esbuilds `--define`: `WeakRef` mot
`self.FT_EXIF.NoRef`, som aldrig har något kvar, och `WebAssembly.instantiate` mot `self.FT_EXIF.instantiate`, som
gör instansen av modulen som workern kompilerade vid starten. Svaret från workern säger vilken instans i ordningen
som läste (`instance`), och testet 'varje läsning får en ny Perl-instans och samma svar' faller om en ny version av
biblioteket håller kvar sin instans på något annat sätt. EXIF och Härkomst använder samma worker.

Detaljrutan visar alla tider i filen (`ExifCore.timeTags()`): som de står i filen, med taggen och samma tid i UTC, eller
"ingen zon i filen". Filsystemets tider står för sig: ur zippen för en fil från Härkomst, annars för kopian på datorn.

### Kartor i EXIF

Kartan delas av EXIF och Positioner. Koden ligger i `tools/_shared/map/`
(`map-core.js`, `map-view.js`, `import-core.js`, `vendor/maps/`). `ToolboxMap.create({ host })`
bygger panelen själv. Positioner läser GPX, KML, CSV, GeoJSON, Google-tidslinje och
inklistrade koordinater. EXIF kan skicka synliga positioner dit via hubben.
- **Miniatyrerna** i bubblorna och popupen: kartan avgör på filens egen typ (`drawableFile`, JPEG, PNG, GIF, WebP,
  BMP, AVIF), inte på bildens. EXIF skickar den lilla JPEG-bilden (`row.thumb`, 240 bildpunkter, för HEIC
  förhandsbilden i filen) eller filen själv för högst 50 bilder (`mapImage`). Det som saknas (filer ur extraktionen
  som inte visats, HEIC, fler än 50 bilder) görs efteråt, en i taget, och skickas i omgångar som
  `{ type: 'positions', update: 'files', files: { exifId: blob } }` (`mapThumbs`, högst 2 000). Huvudfönstret byter
  inte vy för en sådan omgång, och Positioner lägger filerna på punkterna med samma `exifId` (`receiveFiles`).
  Före 2026-11-20 föll HEIC-bilder bort (typen var image/heic), och fler än 50 bilder fick inga miniatyrer.
- **Från Queries** (`QueryRunCore.toPoints`): en rad med filnamn (`ZFILENAME`, `_display_name`) heter som filen,
  med mappen (`ZDIRECTORY`, `relative_path`) i sökvägen. Tiden tas ur en tidskolumn, annars ur en kolumn med date i
  namnet (`ZDATECREATED`, inte `ZTIMEZONENAME` eller update), och punkten säger vilken (`Tid (ZDATECREATED)`). En
  kolumn typ, type, kalla eller provider är punktens typ (GNSS, Wi-Fi, gps). Utan filnamn heter punkten typen eller
  Rad och radens nummer. Miniatyrerna görs efteråt i Queries (`QueriesExtraction.mapThumbs`): förteckningen gås
  igenom en gång till efter filnamnen (Queries sparar bara databaserna), mappen väljer bland filer med samma namn,
  och bilden (HEIC via förhandsbilden) skickas som `update: 'files'` med `fileKey` (`r` + radens nummer), högst 500.
  Före 2026-11-20 hette punkterna queryns titel, tiden saknades och enheten var källans namn.
- **Tiden ur Queries** väljs bland kolumnerna efter vad som går att läsa (`ZEXIFTIMESTAMPSTRING` heter time men har
  kolon i datumet): den gissade, sedan UTC, sedan date, sedan time i namnet. En kolumn som SQL:en räknar om med
  `datetime(…, 'localtime') AS namn` står i datorns zon och får den (`QueryRunCore.localColumns`, `localZone`), så att
  punkten har en verklig tidpunkt. Appen tas ur `ZIMPORTEDBYDISPLAYNAME` (annars bundle-id eller `owner_package_name`)
  och enheten ur `ZCAMERAMAKE` och `ZCAMERAMODEL`. Radens övriga kolumner kan visas i bubblan som egna fält
  (`col:kolumn`, `MapCore.columnKeys`), som bubbeleditorn listar efter de vanliga fälten.
- **Var var telefonen?** Popupen för en punkt med tid och zon frågar huvudfönstret (`phone-positions`, ±5/15/60 min).
  Queries skapas vid behov utan att visas, öppnar extraktionen i raden högst upp och kör katalogernas rollqueryer för
  positioner (`role: location`: Cache.sqlite på iPhone, Rubin på Samsung; `locationQuery` i Queries databaser) för
  fönstret, med `ProvenanceRoles.fill` och `mapRows`. Positionerna blir källan "Telefonen kring <bild> (±N min)", och
  svaret (`phone-positions-done`) står i Positioners status. Provat 2026-11-20 på iPhone-labbzippen: 175 positioner
  ±60 min kring en bild ur Cache.sqlite.
- **Alla bilder i en källa:** knappen Telefonen… i källistan hämtar positionerna runt varje bild med tid och zon i
  en omgång (`marks`): fönstren slås ihop där de går omlott, och varje position säger närmaste bild och hur långt före
  eller efter. Knappen finns bara för filer (en bild ur EXIF eller en rad med filnamn), inte för telefonens egna
  positioner.
- **Videor på kartan** (2026-11-20): EXIF gör miniatyren ur en bildruta en halv sekund in i filmen (`videoFrame`;
  provat med en iPhone-MOV ur labbet). Queries tar telefonens egen miniatyr av en video på iPhone
  (`PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG`, den största), annars en bildruta ur videon (högst 300 MB). Memories
  på kartan får en bildruta ur den dekrypterade videon. Cachens poster med firstframe gäller reklam, inte Memories.
- **Vistelser** (Punkter → Visa positionerna → Vistelser och förflyttningar): positioner i följd inom 100 m under minst
  5 minuter blir en ring per källa (`MapCore.summarizeTrack`, samma gräns som Härkomst), som en punkt med `stay: true`,
  `visit: true`, ankomst och avfärd, och tiden utskriven vid ringens överkant (lagret `visit-label`). Förflyttningarna
  emellan står kvar. Bilder, händelser och punkter utan tid blir aldrig vistelser. Alla punkter är standard och sparas i
  vyn (`viewMode`).
- **Färg efter tid** (Rutt): rutten ritas sträcka för sträcka i en skala från mörkblå till gul (plasma) efter ordningen i
  tiden (rangen, inte den absoluta tiden, så att en enstaka gammal punkt inte gör resten enfärgad), med en skala under valet.
  Orimligt snabba sträckor är röda och streckade som förut (över 250 km/h och 200 m); ett klick på en sådan sträcka
  visar avståndet, tiden, hastigheten och punkterna i båda ändar (`badInfo`, lagret `route-bad`).
- **Samtal och meddelanden i tidslinjen** (knappen i Källor): Positioner skickar ett tidsfönster på ±30 min runt varje
  position med tid och zon (ihopslagna, högst två månader sammanlagt) som `phone-events`. Queries kör katalogernas
  rollqueryer för samtal (`calls`: CallHistory.storedata, calllog.db) och meddelanden (`messages`: Signal, WhatsApp,
  Telegram, Snapchat; `events-messages`: sms.db och mmssms.db, nya dolda queryer i comms-katalogen) och skickar tillbaka
  tid, riktning, vem och app (inte texten). Händelserna har ingen egen position och ritas inte på kartan (2026-11-21:
  en uträknad plats blev missvisande). De går till kartan med `addEvents` (`{ key, kind, ms, name, app, dir, duration,
  source, origin }`, samma key läggs inte till två gånger) och står i tidslinjen (ett band per app, bundle-id blir
  appens namn) och i Händelser utan plats under den: tid, vem, app, riktning, Närmast (positionen närmast i tid bland
  de som ritas, högst 30 min bort, öppnas med ett klick) och Källa (raden i Queries). Ett klick på en romb visar raden.
  Provat på labbet Två telefoner (iOS) 2026-11-21: 11 samtal och 39 meddelanden.
- **Tidslinjen** (`timeline.js`, `MapTimeline`; knappen Tidslinje längst ner): ett band per källa med bilder och
  positioner som streck, händelser som romber och vistelser som staplar. Uppehåll längre än max(2 h, 1/40 av spannet)
  trycks ihop till ett brott med uppehållets längd (`MapTimeline.scale`). Klick öppnar punkten, och uppspelningens
  markör står i tidslinjen. Tiderna på axeln är UTC.
- **Spannet i tidslinjen** (`timeRange`, `setRange`): ett drag väljer ett spann, och kartan, rutten, bubblorna, listan
  och händelserna visar bara det som hände i det (punkter utan tid visas inte). Tidslinjen visar allt och tonar ned det
  utanför. Spannet står som en etikett med en tratt i menyraden, en tratt på knappen Tidslinje och Rensa i tidslinjens
  rad. Allt runt tiden och Visa i tidslinjen (för en klunga) väljer också ett spann (`focusTime(from, to, fit)`).
- **Popupen** (2026-11-21): adressen överst, ur källan när raden har en (`address`, t.ex. Snapchats snap_address_title
  eller en kolumn address/adress i Queries, `QueryRunCore.toPoints`), annars närmaste namngivna väg (inom 120 m) och ort
  i kartan som visas (`nearbyText`, ur de ritade kartrutorna, ingen tjänst frågas; järnväg och färjor räknas inte).
  Rutan Runt <tid> (±5/15/60 min) har Var var telefonen? (bara för filer) och Allt runt tiden, som hämtar positioner
  och sedan samtal och meddelanden (±max(N, 30) min) i tidslinjen och väljer ±N min som spann. Händelser från ett
  tidigare fönster står kvar.
- **Källan i Queries:** varje punkt ur Queries eller rollqueryerna har `origin` (zippens sökväg till databasen, -wal,
  queryns id och titel, SQL:en som kördes med tidsfönstret ifyllt, radernas nummer och huvudtabellen
  `QueryRunCore.mainTable`). Raden/Raderna i Queries i popupen skickar `open-source`; huvudfönstret gör om den till
  `open-query` med zippen (punktens egen eller programmets extraktion), och Queries kör samma SQL och markerar raderna
  (`mark.rows`). En vistelse tar raderna ur den SQL som flest av dess positioner kom ur. Provat på labbet Två telefoner
  (iOS): ett samtal öppnade CallHistory-raden, "Rad 12 av 22 är markerad".
- **Många punkter på samma ställe:** utan gruppering får punkter inom 14 px från varandra en bricka med antalet
  (`stacks`, räknas om när kartan flyttas). Ett klick, och en klunga med gruppering, listar dem per slag (samtal,
  meddelanden per app, filer, vistelser, positioner per typ) med Markera alla och Visa i tidslinjen. Tidslinjen har ett
  band per app för händelserna. Provat med 11 samtal och 39 meddelanden på samma plats (labbet Två telefoner).
- **Aktiva val** står som etiketter i menyraden (`setActive` för verktygets egna, t.ex. Vistelser och En per 10 min;
  kartans egna: Grupperade, Färg efter tid, Rutt per enhet, dolda, spannet i tidslinjen). Etiketten öppnar sin ruta, × tar bort valet.
- **Tidslinjen** visas från början när det finns punkter med tid, tills den stängs med knappen.
- **Vistelsens bubbla:** fälten Ankomst, Avfärd, Varaktighet, Antal positioner, Adress och Källa (databas · tabell) finns i
  Anpassa bubblan, och knappen Ankomst, avfärd och tid i bubblor (under Vistelser) slår på dem för alla vistelser.
- **Listan** har källan som filter (Alla källor), och ritar 250 rader åt gången och fler när man rullar nedåt. Den
  gamla `content-visibility` gjorde att rullningslisten hoppade.
- **Täta positioner** (Punkter → Täta positioner): en per källa och intervall (1, 5, 10, 30 eller 60 min), den med bäst
  noggrannhet. Bilder och punkter utan tid visas alltid, och antalet dolda står i raden överst. Sparas i vyn (`thin`).
- **Återkopplingen** står som en ruta överst till vänster på kartan, under menyraden (`notify(text, 'busy' | 'ok' | 'error')`): busy med snurra,
  ok försvinner efter 9 s, error står kvar tills den stängs. Positioners `setStatus` skriver dit också.
- **Standard:** nålar och ingen gruppering (2026-11-20). Testdataknappen i Positioner är dold (röktestet använder den).
- **Tidsspannet och de namngivna rutterna** står i kartan: tidsspannet i raden längst ner bredvid Spela
  (`addToMenu('time', …)`, knappen visar det valda spannet), rutterna under Rutt. En klickad punkt har Anpassa
  bubblan, Ur rutten och Dölj i popupen, och raden för markerade punkter visas bara för flera eller med listan öppen.
- **Enhet** är bara filens eller radens egen. Positioner satte förr källans namn som enhet; Per enhet räknar nu en
  punkt utan enhet till sin källa (`MapCore.routesBy`).
- **Menyn** är en rad knappar överst på kartan (`.map-bar`): Bakgrund, Punkter, Rutt och Bubblor fäller ut sin ruta
  (`.map-pop`, en i taget, Escape eller ett klick på kartan stänger), och Visa alla, Mät och Spara bild gör sin sak
  direkt. Under Punkter går grupperingen att slå av (`setClustering`, sparas i vyn som `toggles.cluster`). Saknas
  offlinekartan fälls Bakgrund ut en gång. `setMenu(false)` stänger rutorna. Popupen och miniatyren beskär inte
  bilden (`object-fit: contain`), och långa värden bryts inom rutan.

### HEIC (`tools/_shared/heic.js`, `tools/_shared/vendor/libheif/`)

Chromium ritar inte HEIC eller HEIF. `Heic` avkodar bilden med libheif-js 1.23.5 (libheif och HEVC-avkodaren
libde265 i WebAssembly, LGPL-3.0) i en worker och lämnar den som en JPEG.
- **Bara det som visas avkodas.** Avkodaren (2 MB, `libheif-worker.js`) laddas första gången en HEIC ska visas,
  och anroparen frågar efter en bild när den ritas. Två workrar: en för förhandsbilder och små bilder, en för hela
  bilder, så att en stor bild inte håller kvar en lista.
- **HEIC känns igen på innehållet** (`Heic.is`: ftyp-lådans märken; AVIF, som Chromium ritar själv, räknas inte).
- **Förhandsbilden** (`preview: true`): iPhone lägger en bild på 240 × 320 bredvid rutnätet av rutor på 512 × 512.
  libheif räknar den inte som tumnagel, så workern tar den största bilden som varken är huvudbild eller dold och är
  mindre än huvudbilden. Uppmätt i appen på tre bilder ur iOS-labbzippen (3024 × 4032): förhandsbilden på 5–60 ms,
  hela bilden förminskad till 2048 på 0,5–0,6 s. Riktningen är densamma som i telefonens `5005.JPG`.
- **Var:** Chattar (bilagor och förstoring, och galleriet när telefonens tumnagel saknas), Härkomst (filkortet
  avkodar filen före tumnageln, `previewPlan` med `heic`; tumnaglarna i listorna tar förhandsbilden) och EXIF &
  karta (listan och kartan tar förhandsbilden, visningen hela bilden). En fil som inte går att avkoda ger skälet,
  och Härkomst visar då telefonens tumnagel om den finns.
- **Skickad som dokument** (Chattar, `ChatCore.heicFile`): en bilaga som är en fil (inte image/*) med ändelsen
  .heic/.heif/.hif eller HEIC i MIME-typen avkodas och visas, märkt *Dokument* och med *Spara filen* kvar. Är
  innehållet inte HEIC sägs det i stället. En bild som WhatsApp skickat som dokument (typ *dokument*,
  `ChatCore.sentAsDocument`) märks på samma sätt, och förstoringens text börjar med *Dokument*.
- **Licensen:** LGPL-3.0. Biblioteket är en egen fil som kan bytas ut. Licenstexterna och källkodsadresserna ligger
  i mappen (`README.txt`), och `node scripts/vendor-libheif.js` bygger om den från npm. `heic.test.js` kontrollerar
  bundlen mot `VERSIONS.json` och avkodar `fixtures/prov.heic` (64 × 48 med en förhandsbild på 32 × 24, byggd av
  `fixtures/make-heic.js` med ffmpeg och libx265). I html-versionen läggs avkodaren in i Chattar, Härkomst och EXIF &
  karta från början (`EXTRA` i `build-standalone.js`).


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
4. Är verktyget en annan vy av en befintlig sida (som Telefonen, `tools/chats/index.html?view=phone`): ge knappen
   `data-key` med en egen nyckel, så får den en egen ram. Nyckeln är ramens namn i den fristående filen och står i
   `CONTEXT_TOOLS` och `TOOL_PATH` om verktyget ska ha raden med extraktionen.

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
- **Mätning med en stor extraktion** (för hand, ingår inte i provkörningen): `node tests/app/stress-extraction.js <mapp>`
  bygger `Stor-iPhone.zip` (omkring 840 MB, 17 s): 20 000 bilder med telefonens tumnaglar (`5005.JPG`, i snitt
  35 KB), 300 original utan tumnagel och WhatsApp med 50 000 meddelanden i 200 chattar, varav 20 000 i en.
  `node tests/app/stress.js <zip>` öppnar den i Chattar och skriver ut tider, ritade meddelanden och minne.
  Uppmätt 2026-11-18 (NVMe, kall läsning): listan efter 2,3 s, den långa chatten på 0,3 s, högst 1 500
  meddelanden ritade, sökningen på 0,03 s och omkring 970 MB i appens processer. Ett galleri som bara ritar raderna
  som syns läste listan med 20 300 bilder på 71 ms, en tumnagel på 2,6 ms och ett förminskat original på 28 ms,
  och höll 60 bilder per sekund vid snabb rullning.
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
    läses inte om; en lista från disk bedöms; listan visar förloppet och faktorernas lägen med tecken och ord, går att söka
    och välja i, och ett namn med flera träffar blir en rad per träff; Chattar visar WhatsApp-chatten och en lång chatt på 3 000 meddelanden i block,
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
    `1 Labbar/2026-11-02 OnePlus Nord - Signal/Lab-Android-Nord-2026-11-02.zip` under en labbrot: `FT_LAB_ROOT`,
    `~/Documents/Exampleextractions` eller `~/Desktop/vm-images`, den första där filen finns (`tests/app/lab-paths.js`;
    mapparna står i `LÄSMIG.txt` i labbroten). Facit anger sin mapp under roten i `dir`. Zippens storlek, mtime och ctime
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

### Startsidan (2026-11-21)

`#content-placeholder` i Toolbox.html är en telefon med rubriken Vad vill du göra?: knappen Öppna en extraktion (öppnar
Telefonen och väljer zippen med `#cb-input`) och åtta appar (`START_APPS` i src/script.js: Telefonen, Härkomst, Queries,
Positioner, Chattar, EXIF, App-ID och Laboration, plus Inställningar). Ikonen kopieras från verktygets rad i listan
och har samma färg (`--app` per verktyg i src/style.css), och ett tryck klickar på raden. Inställningar visas i telefonen
(`#start-settings`: mörkt läge och verktygslistan, som knapparna högst upp i listan, version och nätverk). Hem överst i
listan, och programmets namn, visar startsidan igen (`showHome`); verktygen står kvar i sina ramar.

### Profilbilder i Chattar och Telefonen (2026-11-21)

Rollen `chat-avatars` (dold query i appens katalog, fälten `address` och `path`) ger en profilbild per adress. Sökvägen
är relativ till mappen där databasen ligger; filen letas upp med och utan .jpg, .jpeg, .thumb eller .png efter namnet
(.jpg först). Bilderna står i `state.avatars` (töms när extraktionen byts) och ritas i rutan för konversationen
(`threadAv`, `data-av`) och i chattens huvud. Bara WhatsApp på iOS har rollen än: `ZWAPROFILEPICTUREITEM` (ZJID, ZPATH
`Media/Profile/<id>-<tid>`, filen heter samma med .jpg). Provat på iPhone-labbet 2026-11-11: en bild på rätt chatt.
Signal hade inga profilbilder sparade i labbet, och Telegrams bilder i Postbox är inte kopplade till chattarna.

### Sparade sidor i webbläsarna (2026-11-21)

Fliken Sparade sidor i en webbläsare i Telefonen läser webbläsarens cache (`tools/_shared/webcache.js`, testad i Node med
påhittade poster ur `tests/app/webcache-builder.js`):

- **WebKit** (Safari och andra appar på iOS): `…/Library/Caches/WebKit/NetworkCache/Version N/Records/<partition>/Resource/<hash>`.
  Posten är WTF::Persistence: versionen (17 på iOS 26), nyckeln (partition, typ, adress, intervall, två SHA-1), tiden
  (WallTime, sekunder som double), rubrikernas SHA-1 och storlek, innehållets SHA-1 och storlek, och om innehållet ligger
  i posten. Annars ligger det i `Blobs/<SHA-1>`. Rubrikerna (adress, typ, HTTP-version och rubrikparen) läses som
  längdprefixade strängar. Cachen hör till appen vars behållare har den i `MCMMetadataIdentifier`.
- **Chromium** (Chrome och Samsung Internet på Android): `…/cache/Cache/Cache_Data/<hash>_0`. Huvudet är 24 byte (magi,
  version, nyckelns längd och hash, utfyllnad), nyckeln är `1/0/_dk_<plats> <ram> <adress>`, ström 1 (innehållet) går
  fram till sitt slut, och ström 0 (HttpResponseInfo) har tiderna (mikrosekunder sedan 1601) och rubrikerna med noll
  mellan raderna. Innehållet sparas som det kom: gzip och deflate packas upp (`DecompressionStream`), brotli i
  skrivbordsappen genom Node (`forensicsMedia.brotli`, IPC `brotli` i electron/main.js, högst 64 MB); i HTML-mappen säger
  sidan att den inte går att packa upp.
- **Sidan** visas direkt när posten öppnas (Källkoden är det andra läget): skript, ramar, omdirigeringar och formulär tas bort, länkarna tappar sin adress (den står i title),
  bilder och stilmallar ur samma cache läggs in som data-adresser, och sidan visas i en ram med `sandbox=""` och en CSP
  som bara tillåter data:. Inget hämtas från nätet. Källkoden går att visa som text.

Provat 2026-11-21 på labbet Två telefoner: Safari på iPhone (718 poster, 10 sidor, alla visas) och Chrome på Samsung
(63 poster, 4 sidor, 3 av dem brotli, alla visas i skrivbordsappen).
