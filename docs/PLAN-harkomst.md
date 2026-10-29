# Plan: Härkomst, tidslinje för en bildfil

Användaren öppnar en extraktion och anger ett filnamn. Appen hämtar själv det som behövs ur
Photos.sqlite, knowledgeC, routined och bildfilen, och bygger en tidslinje runt den tid då filen
skapades. Tidslinjen bedömer tre faktorer: filens skapandetid, vilken app som var igång och om
kameran var igång. Resultatet går att kopiera in i Word i två former: ett protokoll med alla
källor, och en förklaring utan källor för den som inte är tekniker.

Status: byggt i `tools/provenance/` och provkört 2026-10-29 (se sist i dokumentet). Inte committat.
Tänkt som version 1.26. Kvar: provkörning i Word, och Android mot en extraktion med bilder.

Verktyget heter **Härkomst** i sidopanelen och ligger i `tools/provenance/`. Flödet i
`documentation/playbook-image-origin.html` är fortfarande metoden. Härkomst gör steg 1–3 i det
flödet på en gång, och länkar till flödet för resten.

## Vad extraktionerna visar (mätt 2026-10-29, bara läsning)

Fyra iPhone-extraktioner och en Pixel lästes med Python `zipfile` till kopior i en tillfällig
mapp. Zipparna rördes inte.

| Extraktion | iOS/Android | knowledgeC-strömmar som har rader | Bilder i knowledgeC:s täckning |
|---|---|---|---|
| K12345-26 FFS | iOS 18.5 | `/app/usage`, `/app/activity`, `/app/intents`, `/display/isBacklit`, `/device/isLocked`, `/notification/usage`, `/media/nowPlaying` | 9, alla skärmdumpar |
| iPhone Monero FFS | iOS 18.7.7 | samma, plus `/app/webUsage` | 13: 11 skärmdumpar, 2 sparade ur DuckDuckGo |
| Solflare iOS FFS | iOS 18.7.7 | samma | 7 |
| Arkiv `files_full` | iOS 26.0 | samma | 50: 42 kamerabilder, 8 skärmdumpar |
| Pixel `files_full` | Android 16 | Wellbeing: typ 1, 2, 23 (aktivitet), 12, 18, 19, 20, 26, 27 | inga bilder alls, ingen kameraapp i Wellbeing |

Slutsatser som styr planen:
- **`/app/inFocus` finns inte** i knowledgeC på iOS 18 eller 26. Ingen av extraktionerna har en
  enda rad. Det stämmer med att det mesta flyttade till Biome från iOS 16. Appen i förgrunden
  kommer därför från **`/app/usage`**, som finns på alla fyra. `/app/inFocus` behålls bara som
  reserv för äldre iOS.
- **`/app/usage` loggar kameran.** På iOS 26 täcks alla 42 kamerabilder av ett
  `/app/usage`-intervall för `com.apple.camera` (två sessioner, 42 bilder på 32 sekunder), och
  `/display/isBacklit` är 1 vid alla 42. Metoden fungerar alltså på nuvarande iOS.
- **Täckningen är kort:** 3–4 veckor i alla fyra. Fönster utanför den ska ge "saknas".
- **Biome `App.InFocus` finns i FFS-zipparna** under
  `private/var/mobile/Library/Biome/streams/restricted/App.InFocus/local/`, som SEGB-filer
  (version 1 på 18.7.7, version 2 på 18.5), och innehåller `com.apple.camera`. Det är inte
  SQLite och kommer inte med i 1.26, men är det naturliga nästa steget. Se "Inte med i första
  versionen". `files_full`-zippen från iOS 26 har ingen Biome-mapp.
- **Skärmdumpar har tydliga värden:** `ZIMPORTEDBY` 8, `ZIMPORTEDBYBUNDLEIDENTIFIER`
  `com.apple.springboard`, `ZKINDSUBTYPE` 10, `ZSAVEDASSETTYPE` 3. Kamerabilder har
  `ZIMPORTEDBY` 1 och `com.apple.camera`. Sparade ur en app har `ZIMPORTEDBY` 3 och appens
  bundle-id. Tillagd minus Skapad är 0,1–0,3 s för kamerabilder.
- **Wellbeing loggar inte skärmen.** Inga händelser av typ 15 eller 16, och bara en enda typ 18.
  Skärm och lås på Android blir "saknas" i 1.26. Händelserna finns i stället i
  `/data/system_ce/0/usagestats/daily/<tid>` (protobuf, 22 KB på Pixel-zippen), som kräver en
  egen läsare. Se "Inte med i första versionen".
- **Pixel-zippen duger inte som provkörning** för Härkomst: inga bilder, ingen kameraapp. Android
  behöver en annan extraktion.
- **Live Photo-par finns:** `IMG_0004.HEIC` och `IMG_0004.MOV` i K12345-26.

## Extraktionen får aldrig ändras

Det här är det viktigaste kravet, och det är samma krav som i [PLAN-extraktion.md](PLAN-extraktion.md).
Ingen byte i zippen får ändras, och inte heller dess storlek, `mtime` eller `ctime`. Inget får
skrivas bredvid zippen. Det gäller även bildfilen som läses ut ur zippen.

**Hur det säkras i koden:**
- **Samma läsväg som Queries.** Härkomst öppnar zippen med samma moduler som Queries:
  `zip.js`, `locate.js` och `wal.js` i `tools/db-queries/`. Zippen nås bara via `File` från
  `<input type="file">` och `File.slice()`. Ingen ny brygga i `preload.js`, ingen IPC, inget
  File System Access API.
- **Allt som läses ut kopieras till minnet.** Databasen, dess `-wal` och bildfilen läses till
  `Uint8Array` i minnet. WAL läggs på en kopia. `sql.js` och ExifTool körs mot kopior, aldrig mot
  filen.
- **Ingen cache på disk.** Härkomst sparar inget i `localStorage`, `indexedDB` eller på disk.
  Innehållsförteckningen ligger bara i minnet under sessionen.
- **Exporterna är de enda filerna som skrivs**, och de skrivs via webbläsarens vanliga
  nedladdning, alltså till den mapp användaren väljer, aldrig automatiskt bredvid zippen.
- **Testet som vaktar utökas.** Testet i `zip.test.js` som grep:ar efter skrivande API:er
  (`createWritable`, `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`,
  `FileSystemHandle`, `forensicsMedia`, `ipcRenderer`, `require(`, `fs.`, `localStorage`,
  `indexedDB`) får en lista över alla filer i `tools/provenance/` och den nya
  `extraction-core.js`. Nya filer i mappen fångas automatiskt, eftersom testet läser katalogen.

**Hur det kontrolleras:**
- **Enhetstest.** Hela flödet körs i Node mot en Buffer som jämförs byte för byte före och efter.
- **Provkörning i Electron mot K123456-26.** Före och efter hela flödet (öppna zippen, hämta
  filen, bygga tidslinjen, båda exporterna, spara bild) jämförs SHA-256 för hela zippen, storlek,
  `mtime` och `ctime` på nanosekunden. Samma rutin som 2026-10-23.
- **Åtkomsttiden** (`atime`) ligger i filsystemet, inte i zippen. Den redovisas som i
  extraktionsplanen, och hjälptexten rekommenderar arbetskopia eller skrivskyddad volym.

## -wal läses alltid med

Poster som bara finns i `-wal` är ofta de senaste, och i en härkomstbedömning är de ofta de
som räknas. Därför:

- **Alla databaser läses med sin `-wal`.** `locate.js` kopplar redan `-wal`, `-shm` och
  `-journal` till databasen. Härkomst läser databasen och `-wal` ur zippen, kontrollerar CRC32,
  räknar SHA-256 på båda, lägger på WAL-ramarna fram till sista giltiga commit (`wal.js`,
  samma som "Kör i appen") och kör sedan rollqueryerna mot kopian i minnet. `-shm` behövs inte,
  eftersom den bara är ett index över `-wal`.
- **Saknad `-wal` sägs rakt ut, på tre ställen.** En varning i verktyget, en rad i protokollet
  ("knowledgeC.db lästes utan `-wal`: extraktionen har ingen") och en mening i förklaringen
  ("Den senaste tidens registreringar kan saknas för …"). Verktyget vägrar inte, eftersom en
  extraktion utan `-wal` är ett faktum som ska bedömas, inte ett fel.
- **`-journal`** ger samma varning som i Queries: innehållet kan vara mitt i en transaktion.
- **Antalet WAL-ramar** som lades på står i protokollet per databas, så att det går att se att
  `-wal` verkligen användes.
- **Test.** Ett test bygger en databas där filens rad bara finns i `-wal`, och kräver att
  Härkomst hittar den. Ett annat test kräver att varningstexten finns i båda exporterna när
  `-wal` saknas.

## Hypotesstöd, inte slutsats

Bedömningen säger "förenligt med", "inte förenligt med" eller "går inte att bedöma". Den säger
aldrig att telefonen tog bilden. Ordvalet ligger i en tabell i kärnmodulen och testas som text.
Det följer principerna i [PLAN.md](PLAN.md).

Det viktigaste läget är **saknas**. knowledgeC täcker normalt bara några veckor, och på iOS 15
och senare ligger delar av appaktiviteten i Biome, som inte är SQLite. Att inget hittas får
aldrig redovisas som att kameran inte var igång. Förklaringen skriver det i klartext:
"Det finns ingen registrering av vilken app som var öppen vid den här tiden. Det betyder inte
att ingen app var öppen."

## Vad användaren gör

1. **Öppna extraktion…** Samma knapp och samma lista som i Queries. Härkomst visar bara de
   databaser det behöver: Photos.sqlite (den vanliga markerad), knowledgeC, routined, och på
   Android MediaStore och Wellbeing. iOS-versionen läses ur `SystemVersion.plist` som i dag.
2. **Ange filnamn.** Ett fält för filnamnet, till exempel `IMG_1234.HEIC`. Flera träffar
   (samma namn i PhotoData och Syndication, eller en redigerad kopia) visas som en lista att
   välja ur. Från Queries går det att komma hit med filnamnet ifyllt, via länken
   "Härkomst för den här filen…" på en rad i Photos- eller MediaStore-resultatet. Länken bär bara
   filnamn och iOS-band i adressen, inga filer.
3. **Välj fönster.** Standard ±15 minuter runt skapandetiden. Går att ändra till ±5 minuter,
   ±1 timme eller ±24 timmar.
4. **Läs resultatet.** Tidslinjen, de tre faktorerna och händelselistan.
5. **Exportera.** "Kopiera protokoll för Word", "Kopiera förklaring för Word", "Spara som HTML"
   och "Spara bild".

Härkomst visar ingen EXIF-tabell, ingen karta och ingen SQL. EXIF & karta, Positioner och
Queries finns redan för det. I stället finns länkar: "Öppna i EXIF & karta" (bara när
bilden finns som fil på disk, se "Inte med i första versionen"), "Visa på karta" bara om
routined gav positioner (skickar punkter via hubben som i dag), och varje rad i protokollet
anger queryns id så att den går att öppna i Queries.

## Typ av fil först

Innan faktorerna bedöms avgör verktyget vilken sorts fil det är, för frågan "skapade telefonen
filen" betyder olika saker för olika typer. Typen står överst i båda exporterna.

| Typ | iOS | Android | Vad faktorerna betyder |
|---|---|---|---|
| **Kamerabild** | `ZIMPORTEDBY` 1 eller 2, eller `com.apple.camera` | `relative_path` under `DCIM/Camera`, ägare kameraapp | alla tre faktorer som nedan |
| **Skärmdump** | `ZIMPORTEDBY` 8, `com.apple.springboard`, `ZKINDSUBTYPE` 10 | `Pictures/Screenshots`, MIME png | kameran är inte tillämplig. Faktor 2 blir den viktiga: appen i förgrunden vid T är det som fanns på skärmen |
| **Sparad ur en app** | `ZIMPORTEDBY` 3 och appens bundle-id | `owner_package_name` är en annan app än kameran | faktor 2 jämför mot den appen. Faktor 3 blir "skaparappen var i förgrunden" |
| **Mottagen eller synkad** | Tillagd långt efter Skapad, eller `ZSAVEDASSETTYPE` som iLEAPP anger som moln | `date_added` långt efter `datetaken` | se "Två fönster" nedan |
| **Redigerad kopia** | `ZEDITORBUNDLEID` satt, eller Ändrad skiljer sig från Skapad | `date_modified` skiljer sig | ändringen visas som egen händelse |

Typen är en upplysning med värdena som grund, inte en slutsats. Värdenas betydelse tas från
iLEAPP:s tabeller och ligger i katalogen.

### Två fönster

När Tillagd ligger mer än fönstret efter Skapad är det två tidpunkter som betyder något: när
filen skapades (ofta på en annan enhet) och när den kom till telefonen. Då byggs två tidslinjer,
"när filen skapades" och "när filen kom till telefonen", och appen i förgrunden vid Tillagd
säger vilken app som tog emot eller sparade den. Förklaringen får två listor med varsin rubrik.

### Grannar

Bilder tas sällan ensamma. Verktyget visar de bilder i biblioteket som skapades inom fönstret,
och de närmaste i nummerordning (`IMG_0041` före `IMG_0042`). Grannar som kommer från samma app
tätt inpå, till exempel en serie kamerabilder, är ett stöd i sig och syns i tidslinjen som små
markörer på raden **Fil**. En Live Photo-video med samma nummer visas som par, med sin egen tid
ur QuickTime (i UTC, som EXIF & karta redan hanterar). Protokollet listar grannarna. Förklaringen
nämner dem bara som en mening: "Sju bilder till togs inom en minut."

## De tre faktorerna

Tiden T är filens skapandetid: `ZDATECREATED` på iOS, `datetaken` på Android. Tolerans 5 s
när ett intervall ska "täcka" T.

### 1. Skapandetid

| Källa | iOS | Android |
|---|---|---|
| Skapad | `ZASSET.ZDATECREATED` (`ZGENERICASSET` i iOS 10–13) | `files.datetaken` |
| Tillagd i biblioteket | `ZADDEDDATE` | `files.date_added` |
| Ändrad | `ZMODIFICATIONDATE` | `files.date_modified` |
| EXIF enligt databasen | `ZEXIFTIMESTAMPSTRING`, `ZTIMEZONENAME`, `ZTIMEZONEOFFSET` | – |
| Skaparapp | `ZIMPORTEDBYBUNDLEIDENTIFIER` (iOS 15+), `ZCREATORBUNDLEID` (iOS 10–14), `ZIMPORTEDBYDISPLAYNAME` | `files.owner_package_name` |
| Typ | `ZSAVEDASSETTYPE`, `ZIMPORTEDBY` enligt iLEAPP:s tabeller | `relative_path` under `DCIM/Camera` |
| Kamera enligt databasen | `ZEXTENDEDATTRIBUTES.ZCAMERAMAKE`, `ZCAMERAMODEL` | – |
| EXIF i själva filen | `DateTimeOriginal`, `OffsetTimeOriginal`, `Make`, `Model`, `Software` via ExifTool | samma |
| Filsystemets ändringstid | zip-postens ändringstid för filen under `DCIM` (extraktionen bevarar den) | samma |

- **Stöd:** Tillagd minus Skapad är högst 60 s, och EXIF i filen stämmer med Skapad inom 60 s
  i filens zon, och Make/Model i filen stämmer med databasen när båda finns.
- **Motsägelse:** EXIF i filen skiljer sig mer än 60 s från Skapad, eller Make/Model i filen
  skiljer sig från databasen, eller Tillagd ligger mer än en timme efter Skapad. Varje avvikelse
  skrivs ut med båda värdena.
- **Saknas:** filen finns inte i databasen, eller Skapad är NULL. Finns raden men inte filen i
  zippen (iCloud-optimerat bibliotek, eller raderad) sägs det, och EXIF ur filen blir "saknas".
- **Upplysning, inte avgörande:** `ZSAVEDASSETTYPE`, `ZIMPORTEDBY`, `ZTRASHEDSTATE`, `ZHIDDEN`
  och `ZEDITORBUNDLEID` visas med iLEAPP:s klartext. Värdenas betydelse skrivs in i katalogen
  och kontrolleras mot iLEAPP i provkörningen, inte i verktyget.

### 2. App igång

| Källa | iOS | Android |
|---|---|---|
| App igång | knowledgeC `/app/usage` (`ZSTARTDATE`–`ZENDDATE`, `ZVALUESTRING`). Finns på iOS 18 och 26 och loggar kameran. | Wellbeing `events` typ 1 (RESUMED) till nästa typ 2/23 (PAUSED/STOPPED) för samma paket |
| App i förgrunden, äldre iOS | knowledgeC `/app/inFocus`, bara som reserv när strömmen har rader | – |

Protokollet säger vilken ström som användes. "App igång" är ordet i rapporterna, eftersom
`/app/usage` är en användningssession, inte strikt förgrund.

- **Stöd:** ett intervall som täcker T har samma bundle-id eller paketnamn som skaparappen.
  Kameran räknas som skaparapp när `ZIMPORTEDBYBUNDLEIDENTIFIER` är `com.apple.camera` eller
  NULL med `ZIMPORTEDBY` 1 eller 2 (bak- och framkamera enligt iLEAPP).
- **Motsägelse:** ett intervall för en annan app täcker T, och ingen rad för skaparappen
  ligger inom toleransen.
- **Saknas:** inga rader alls i strömmen inom fönstret, databasen finns inte, eller fönstret
  ligger utanför strömmens täckning. Täckningen mäts som första och sista `ZSTARTDATE` i
  strömmen och skrivs i protokollet, så att "saknas" går att förklara.

### 3. Kamera igång

- **iOS:** `/app/usage` för `com.apple.camera` som täcker T (`/app/inFocus` som reserv på
  äldre iOS).
- **Android:** Wellbeing-intervall för ett kamerapaket som täcker T. Kamerapaketen hämtas ur
  App-ID-katalogen (`tools/app-ids/catalog.js` har redan systemets och tillverkarnas kameraappar),
  inte ur en egen lista.
- **Tredjepartsapp med egen kamera.** När skaparappen är till exempel Snapchat ger
  `com.apple.camera` inga rader, eftersom appen använder kameran i sin egen process. Då bedöms
  faktor 3 som "skaparappen var i förgrunden" och rubriken i rapporten säger det. Det är ett
  medvetet val som gör att en Snapchat-bild inte får en falsk motsägelse.
- **Stöd, motsägelse, saknas** som i faktor 2.

### Stöd från skärm och lås

- `/display/isBacklit` med värdet 0 som täcker T är en **motsägelse** mot att bilden skapades
  av användaren vid T. Värdet 1 är stöd.
- `/device/isLocked` visas i tidslinjen men fäller ingen faktor, eftersom kameran går att starta
  från låsskärmen.
- Android: Wellbeing loggar inte skärmen (mätt på Pixel, Android 16: inga händelser av typ 15
  eller 16). Skärm och lås blir "saknas" på Android i 1.26, och rapporterna säger varför.
  Wellbeing finns dessutom bara på Pixel och vissa andra telefoner, så "app igång" kan också bli
  "saknas" på till exempel Samsung. Det skrivs i hjälptexten.

### Position (byggd 2026-10-29)

En fjärde faktor och en egen del i resultatet. Positionerna samlas från tre håll och visas i en
tabell med tid, vad, latitud, longitud, noggrannhet, avstånd från bildens position och källa:

- **Bilden enligt databasen:** `ZLATITUDE`/`ZLONGITUDE` i Photos.sqlite (−180 betyder saknas).
- **Bilden enligt EXIF i filen:** GPS-taggarna ur bildfilen i zippen, via ExifTool.
- **Telefonen:** routined `ZRTCLLOCATIONMO` i fönstret (GNSS och Wi-Fi), rollen `location`.

Bedömningen tar den position från telefonen som ligger närmast i tid. Stöd om avståndet är inom
max(100 m, 2 × noggrannheten), motsägelse över 1 km, däremellan en upplysning om möjligt GPS-fel.
EXIF-positionen jämförs också med databasens. Saknar filen position blir det en upplysning;
saknas routined blir det "saknas" med orsak. Alternativet "mottagen" får avståndet som skäl.

Kartan är den delade kartvyn (`tools/_shared/map/map-view.js`) med nålar: bilden röd, telefonen
lila med noggrannhetsring, menyn dold. Kartvyn fick `toImage()`, `setMarker()` och `setMenu()`.
Kartbilden följer med i båda exporterna, med samma fot som kartans Spara bild. Hämtningen har
en tidsgräns på tio sekunder, så att exporten inte väntar på en karta som aldrig ritas.

**Provkört:** kärnan och rapporterna i Node (234 tester). Kartan i Electron kunde inte ses, för
Chromium ritar inga bildrutor när sessionen är låst, och kartans laddning väntar på en ritad
bildruta. Tabellen, faktorn och exporten utan karta är kontrollerade i appen.

## Händelselistan och ordförrådet

Allt som visas, både tidslinjen och exporterna, byggs från en enda lista med händelser. Varje
händelse har tid i UTC, typ, värde, källa (databas, tabell eller ström, kolumn), queryns id och
raden den kom ur. Intervall har start och slut.

Förklaringen får en mening per händelsetyp. Tabellen ligger i `timeline-core.js` och testas:

| Händelse | Förklaringen skriver |
|---|---|
| `/display/isBacklit` 1 / 0 | "Skärmen tänds" / "Skärmen släcks" |
| `/device/isLocked` 0 / 1 | "Telefonen låses upp" / "Telefonen låses" |
| `/app/usage` start / slut | "{App} öppnas" / "{App} lämnas" |
| `/app/inFocus` start / slut (äldre iOS) | samma ord |
| Granne skapad | "Bilden {filnamn} skapas" i samma lista, utan fetstil |
| Skapad | "Bilden {filnamn} skapas" (med "av {App}" när skaparappen är känd) |
| Tillagd | "Bilden läggs till i Bilder" (bara när den skiljer sig från Skapad) |
| Ändrad | "Bilden ändras" (bara när den skiljer sig från Skapad) |
| routined position | "Telefonen registrerar en position" (koordinaten står i protokollet) |
| Wellbeing RESUMED / PAUSED | "{App} öppnas" / "{App} lämnas" |

Appnamn kommer från App-ID-katalogen: `com.apple.camera` blir "Kamera" och
`com.toyopagroup.picaboo` blir "Snapchat". Okända id visas som de är.

Händelser som ligger utanför dagens kataloger, till exempel att en snap skickas, kommer med den
dag en katalog för den databasen får en roll. Verktyget ändras inte för det.

## Tidslinjen

- Ritad i SVG utan bibliotek. En tidsaxel i bevisets zon, ett lodrätt streck vid T, och en rad
  per källa: **Fil** (markörer för Skapad, Tillagd, Ändrad och EXIF), **App i förgrunden**
  (intervall med appnamn), **Kamera**, **Skärm**, **Lås**, **Position** (bara om routined gav
  rader).
- Fönstret är det användaren valde. Händelser utanför fönstret visas inte, men räknas i
  protokollet ("12 appbyten till inom ±24 h").
- Fot som på kartans rapportbild: programversion, tidszon, när bilden skapades.
- "Spara bild" renderar SVG till PNG via canvas, samma teknik som kartans rapportbild.

## Två exporter

Båda byggs från samma händelselista och samma bedömning. Skillnaden är filter och språk.

### Protokoll

1. **Huvud.** Extraktionens filnamn, storlek och ändringstid. iOS-version ur
   `SystemVersion.plist` eller Android-märkning. Tidszon som används och var den kommer ifrån
   (`ZTIMEZONENAME` för filen, annars vald av användaren och märkt "antagen"). Programversion
   och tidpunkt för exporten.
2. **Filen.** En tabell med raden ur Photos.sqlite eller MediaStore, kolumn för kolumn, med
   databasens kolumnnamn. Därunder EXIF-fälten ur filen med sökvägen i zippen och filens
   CRC32 och SHA-256.
3. **Bedömning.** Typ av fil. De tre faktorerna med läge, en mening per faktor, och vilka
   händelser som avgjorde. Därefter **alternativen**: en rad per annan förklaring (mottagen,
   synkad från moln, sparad ur app, skärmdump, redigerad kopia) med vad i materialet som talar
   för eller emot den. Det är den delen en motpart kommer att fråga efter.
4. **Tidslinjen** som bild.
5. **Händelser.** Tabell i tidsordning: tid i UTC, tid i bevisets zon, händelse, värde, källa
   som databas → tabell/ström → kolumn, queryns id.
6. **Källor.** Per databas: sökväg i zippen, storlek, ändringstid i zippen, CRC32, SHA-256
   för databasen och för `-wal`, antal WAL-ramar som lades på, eller texten om att `-wal`
   saknas. Strömmarnas täckning i knowledgeC.
7. **Bilaga.** Exakt SQL för varje rollquery och parametrarna den kördes med.

### Förklaring

1. **En rad om vad som undersökts.** "Bilden IMG_1234.HEIC på telefonen, och vad telefonen
   registrerade tio minuter före och efter."
2. **Händelserna** i tidsordning, en per rad, med klockslag och ordförrådet ovan. Skapandet
   av bilden är fetstilt. Händelser från samma app som följer tätt på varandra (under 2 s)
   slås ihop, så att listan inte fylls av brus.
3. **Vad det betyder.** Tre korta meningar, en per faktor, i klartext. För saknas används
   meningen från avsnittet om hypotesstöd.
4. **Tidslinjen** som bild.
5. **Om `-wal` saknas:** meningen om att den senaste tidens registreringar kan saknas.

Inga hashar, inga sökvägar, inga kolumnnamn, inga bundle-id. Tidszonen nämns en gång, i första
raden. Ett test kräver att förklaringen inte innehåller något som ser ut som en hash, en
sökväg eller ett bundle-id, och att protokollet innehåller allt det.

## Kopiera till Word

- **Urklipp som HTML.** Knapparna "Kopiera … för Word" lägger exporten på urklipp med
  `navigator.clipboard.write` och en `ClipboardItem` med `text/html` och `text/plain`. Word
  gör tabeller av `<table>` och rubriker av `<h1>`–`<h3>`. Stilarna ligger inline och är
  enkla (kantlinjer, fetstil), eftersom Word bortser från det mesta annat.
- **Tidslinjen som PNG** i samma HTML, som `data:`-URI.
- **Provkörning i Word krävs.** Inklistring med inbäddade bilder beter sig olika mellan
  Word-versioner. Provkörs i Word 365 på Windows och i LibreOffice. Fungerar bilden inte
  räcker "Spara bild" och att dra in den för hand. Det är därför ingen egen docx-skrivare
  byggs från början.
- **"Spara som HTML"** sparar protokollet eller förklaringen som en fristående fil med bilden
  inbäddad, för arkivering.
- **Fungerar i HTML-versionen.** `file://` räknas som säker kontext i Chromium, så urklippet
  fungerar även i `Toolbox.html`. Det kontrolleras i provkörningen.

## Delar

### 1. Roller i katalogerna
- **Nytt fält `role`** på queries som Härkomst använder: `file`, `neighbours`, `app-focus`
  (`/app/usage` på iOS, `/app/inFocus` som reserv, Wellbeing på Android), `screen`, `lock`,
  `location`. Rollqueryer är vanliga poster i `catalog.json` med
  `hidden: true`, så att de inte syns i Queries-listan men testas av `catalogs.test.js` och
  kan visas i protokollets bilaga.
- **Råa tider.** Rollqueryerna returnerar tidskolumnerna som de står i databasen, utan
  `datetime(..., 'localtime')`. Posten anger `epoch`: `cocoa`, `unixS` eller `unixMs`.
  Verktyget gör om till UTC och visar i bevisets zon.
- **Fältkarta.** Posten har `fields`, som kopplar betydelse till kolumn, till exempel
  `{ "created": "ZDATECREATED", "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER" }`. Så ligger
  skillnaderna mellan Photos-banden i katalogen, inte i verktyget: iOS 10–14 har
  `ZCREATORBUNDLEID`, iOS 15+ har `ZIMPORTEDBYBUNDLEIDENTIFIER`.
- **Exakt filnamn.** Rollen `file` söker på exakt `ZFILENAME` eller `ZORIGINALFILENAME`
  (`_display_name` på Android), inte `LIKE`. Flera träffar visas.
- **Kamera och skaparapp.** Bundle-id och paketnamn för kameraappar hämtas ur App-ID-katalogen.
- **Test.** `catalogs.test.js` kräver att varje Photos-band och MediaStore har rollen `file`,
  att knowledgeC och Wellbeing har `app-focus`, att varje rollquery har `epoch` och `fields`,
  och att varje kolumn i `fields` finns i SQL:en. `photos-catalog.test.js` kör rollqueryerna
  mot iLEAPP-schemat per iOS-version som i dag.

### 2. Delad extraktionsläsning (`tools/db-queries/extraction-core.js`, UMD, testas i Node)
- Den DOM-fria delen av `extraction.js` flyttas hit: mål ur katalogerna, läsning av
  innehållsförteckningen med `keeper`, `locate`, iOS-version, `zipSource` med CRC32-raden.
  Queries och Härkomst använder samma modul. `extraction.js` behåller bara gränssnittet.
- **Bildfilen ur zippen.** När filens rad är känd görs en andra genomgång av
  innehållsförteckningen efter `DCIM/<ZDIRECTORY>/<ZFILENAME>` (Android: `_data` utan
  prefix). Den tar 0,4 s på 568 526 poster, så den första genomgången ändras inte. Filer över
  200 MB läses inte för EXIF, med en rad om varför.
- Write-guard-testet täcker filen.

### 3. Kärnan (`tools/provenance/timeline-core.js`, UMD, testas i Node)
- Tar rollqueryernas rader och `epoch` och ger händelselistan i UTC.
- Bygger intervall ur Wellbeing-händelser (RESUMED till nästa PAUSED/STOPPED).
- Bedömer de tre faktorerna enligt reglerna ovan och ger ett resultat med läge, mening och
  avgörande händelser per faktor.
- Ordförrådet för förklaringen, hopslagning av täta händelser, och text för "saknas".
- Tester: alla tre faktorer stöds; app i förgrunden är en annan; inget knowledgeC alls;
  fönster utanför strömmens täckning; skärmen släckt vid T; Snapchat-fallet; EXIF i filen
  skiljer sig från databasen; Android med Wellbeing; raden bara i `-wal`; ordförrådet som text.

### 4. Gränssnittet (`tools/provenance/index.html`, `script.js`, `style.css`)
- Delade skalet `../_shared/toolkit.js` för temat, som andra verktyg.
- Extraktionsrutan, filnamnsfältet, fönsterväljaren, tidslinjen, faktorerna, händelselistan
  och knapparna. Status medan databaserna läses.
- ExifTool-motorn från EXIF & karta (`vendor/exiftool`) körs i en worker mot bildfilens bytes.
  Bara de fält som faktor 1 behöver läses ut.
- Knapp i `Toolbox.html` under Queries. README, `docs/DEVELOPMENT.md` och tabellen i
  [PLAN.md](PLAN.md) (flödet "Bildfil – härkomst") uppdateras.

### 5. Exporterna (`tools/provenance/report.js`, UMD, testas i Node)
- Bygger protokollet och förklaringen som HTML-strängar från samma modell. Tidslinjen tas in
  som en PNG-sträng.
- Tester: protokollet innehåller varje hash, sökväg och query-id; förklaringen innehåller
  inget av det; båda innehåller `-wal`-varningen när den gäller; texten för varje läge.

### 6. Tidslinjen (`tools/provenance/timeline-svg.js`)
- SVG från händelselistan och fönstret. PNG via canvas för "Spara bild" och urklippet.

## Ordning

1. Del 1 och 2: roller i katalogerna och `extraction-core.js`, med tester. Queries ska se ut
   och fungera som i 1.25 efter flytten.
2. Del 3: kärnan med tester, innan något gränssnitt finns.
3. Del 4 och 6: gränssnitt och tidslinje. Provkörning mot K123456-26 i Electron.
4. Del 5: exporterna. Provkörning i Word 365 och LibreOffice, och i `Toolbox.html`.
5. Kontroll att zippen är oförändrad: SHA-256, storlek, `mtime`, `ctime`.

## Provkörning (ska göras innan 1.26 släpps)

- **Kamerabild:** Arkiv `files_full` (iOS 26.0). 42 kamerabilder i två kamerasessioner
  2025-09-24 och 2025-10-01, alla med `/app/usage` för `com.apple.camera` och skärmen tänd.
  Alla tre faktorerna ska bli stöd, och grannarna ska visa serien.
- **Skärmdump:** K12345-26 FFS (iOS 18.5), `IMG_0020.PNG`–`IMG_0025.PNG` 2026-03-02. Typen ska
  bli skärmdump, kameran "inte tillämplig", och appen igång vid T ska visas.
- **Sparad ur en app:** iPhone Monero FFS (iOS 18.7.7), `IMG_0008.GIF` och `IMG_0009.GIF`
  från DuckDuckGo 2026-09-15. Faktor 2 ska jämföra mot DuckDuckGo.
- **Utanför täckningen:** en bild i Arkiv-zippen som är äldre än knowledgeC:s första rad. Alla
  faktorer utom skapandetiden ska bli "saknas", med täckningen utskriven.
- **Live Photo:** `IMG_0004.HEIC` och `IMG_0004.MOV` i K12345-26 ska visas som par.
- **Android:** Pixel-zippen har inga bilder. Provkörningen kräver en annan Android-extraktion
  med bilder under `DCIM/Camera` och en Wellbeing-databas. Finns ingen, släpps 1.26 med
  Android-delen märkt "oprövad" i `docs/DEVELOPMENT.md`.
- **Zippen oförändrad.** Som i extraktionsplanen, före och efter hela flödet.
- **Word.** Klistra in båda exporterna. Kontrollera tabeller, rubriker och bilden.
- **Tidszon.** En bild med `ZTIMEZONENAME` som inte är datorns zon. Klockslagen i
  förklaringen ska vara i bildens zon.

## Inte med i första versionen

- **Mapp i stället för zip.** Samma skäl som i extraktionsplanen.
- **Öppna bilden i EXIF & karta direkt ur zippen.** Det kräver att en `Blob` skickas mellan
  ramar via hubben. Hubben skickar i dag bara punktdata, och det valet ändras inte nu. Länken
  visas bara när bilden finns på disk.
- **Biome `App.InFocus` (iOS 16+).** Strömmen finns i FFS-zipparna som SEGB-filer och
  innehåller kameran. En läsare för SEGB version 1 och 2 är liten (huvud, poster med tid och
  protobuf-innehåll) och projektet har redan en protobuf-avkodare i Magic Text. Det är det
  naturliga nästa steget efter 1.26, som en egen händelsekälla med rollen `app-focus`, och
  skulle ge förgrund på sekundnivå där `/app/usage` bara ger sessioner.
- **Android `usagestats` (protobuf).** Skärm, lås och förgrund per sekund ligger i
  `/data/system_ce/<användare>/usagestats/daily/`. Samma protobuf-avkodare kan användas. Det
  skulle ge Android det som Wellbeing saknar.
- **Fler händelsekällor:** meddelandedatabaser, Safari. De kommer som roller i nya kataloger.
- **Egen docx-skrivare.** Bara om provkörningen i Word visar att urklippet inte räcker.
- **Flera filer åt gången.**

## Beslut

- **Bara zip, bara läsning.** Se avsnittet högst upp.
- **`-wal` alltid.** Se avsnittet om `-wal`.
- **Förenligt eller inte förenligt, aldrig en slutsats.** Och "saknas" skrivs ut i klartext i
  båda exporterna.
- **Inga nya vyer för EXIF, karta eller SQL.** Härkomst länkar till de verktyg som finns.
- **Rollerna ligger i katalogerna.** Verktyget har ingen egen SQL.

## Provkörning 2026-10-29

- **Enhetstester.** `npm test`: 228 tester, varav 31 nya för roller, extraktionsläsning, kärnan,
  rapporterna och tidslinjen. Write-guard-testet omfattar alla filer i `tools/provenance/`.
- **Kärnan mot riktiga extraktioner i Node** (utan webbläsare, utan EXIF), med `fs.readSync` på
  begärda bitar av zippen:
  - Arkiv `files_full` (iOS 26.0), `IMG_0001.HEIC`: kamerabild, alla faktorer stöd. Kameran
    `/app/usage` 12:30:50–12:31:22 UTC täcker T, skärmen tänd, olåst. Grannar: 33 bilder inom
    7 minuter, och `IMG_0002.HEIC` i nummerordning.
  - K12345-26 FFS (iOS 18.5), `IMG_0020.PNG`: skärmdump (ZIMPORTEDBY 8, springboard,
    ZKINDSUBTYPE 10). Kameran "inte tillämplig". På skärmen vid T: MetaMask.
  - iPhone Monero FFS (iOS 18.7.7), `IMG_0008.GIF`: sparad ur DuckDuckGo. Skaparappen igång vid T.
  - Zipparna oförändrade: storlek, `mtime` och `ctime` på nanosekunden lika före och efter.
- **Hela appen i Electron**, styrd via DevTools-protokollet mot samma tre extraktioner:
  - Zippen öppnas (0,0–0,4 s för innehållsförteckningen), filen hittas, databaserna läses med
    `-wal`, bildfilen läses ur zippen och ExifTool-workern laddas först då. EXIF-tiden i
    `IMG_0001.HEIC` (05:31:09.622 −07:00) stämmer med ZDATECREATED, och Make/Model (Apple
    iPhone 14) stämmer med databasen.
  - Tidslinjen ritas och blir PNG. Bildens egen tidszon väljs som standard (ZTIMEZONENAME).
  - "Kopiera … för Word" lyckas för båda exporterna vid ett riktigt klick. Själva inklistringen
    i Word 365 och LibreOffice återstår att prova, på en Windows-dator.
  - Det som hittades och rättades: `/app/inFocus` saknas, så app och kamera kommer ur
    `/app/usage`; en träff på ZORIGINALFILENAME (molnkopia med UUID-namn) sorteras efter den
    exakta träffen; iOS-systemtjänster (Inställningsassistenten, Kod-/Face ID-ruta, Plånbok-ruta,
    Hemskärmen) fick namn i App-ID-katalogen så att förklaringen inte visar bundle-id.
- **Inte provkört:** Android (Pixel-zippen saknar bilder), inklistring i Word, HTML-versionen
  (`Toolbox.html`).


## Snapchat och "Var finns filen?" (beta, byggd 2026-10-29)

Bakgrund: bildfiler med härkomst från Snapchat saknar ofta rad i Photos.sqlite, eftersom
Photos bara känner till filer som sparats till bildbiblioteket. Provkörning mot K12345-26
(iOS 18.5, Snapchat installerat) visade var uppgifterna finns i stället. Allt nedan är
kontrollerat mot den extraktionen och bara den, därför **beta**: strukturen kan skilja sig
mellan Snapchat-versioner, och tolkningen av typkoderna är härledd ur en enda telefon.

### Fynd i K12345-26

- Sparade snaps **finns** i Photos.sqlite: `ZIMPORTEDBYBUNDLEIDENTIFIER = com.toyopagroup.picaboo`,
  `ZSAVEDASSETTYPE = 6`, inget Make/Model, ingen GPS, `ZORIGINALFILENAME = <UUID>.mp4`.
- Snapchats cache ligger i appens behållare under `Documents/com.snap.file_manager_3_SCContent_<konto>/`
  med filnamn = cachenyckel, utan ändelse. Registret är `Documents/global_scoped/cachecontroller/cache_controller.db`:
  `CACHE_FILE_CLAIM` (CACHE_KEY, MEDIA_CONTEXT_TYPE, EXTERNAL_KEY, CREATION/EXPIRATION/DELETED_TIMESTAMP_MILLIS)
  och `CACHE_FILE_METADATA` (FILE_SIZE_BYTES, LAST_READ_TIMESTAMP_MILLIS). Tider i Unix-millisekunder.
- `MEDIA_CONTEXT_TYPE` 3 = chattmedia, `EXTERNAL_KEY = 1:<konversations-uuid>:<server_message_id>:0:0`,
  som matchar `conversation_message` i `Documents/user_scoped/<uid>/arroyo/arroyo.db`
  (`client_conversation_id`, `server_message_id`, `creation_timestamp`, `read_timestamp`).
  34 = video inspelad med Snapchats kamera (`<UUID>~1`), samma bytes som
  `Library/Caches/user_scoped/<uid>/recorded_videos/recorded-<uptid>.mp4`. 16/24 = story-video och
  första bildruta, 7/13 = bilder från Snapchats CDN, 1/12 = linser.
- Avsändaren står i protobufen `message_content`: fält 2 → fält 1, 16 byte. Samma id finns i
  `snapchatter.userId` i `Documents/user_scoped/<uid>/DocObjects/primary.docobjects`, där
  användarnamnet ligger i kolumnen `p` (en FlatBuffer med längdprefixade strängar). Mediets AES-nyckel (32 B) och IV (16 B) ligger i
  samma meddelande. Det egna kontots uuid står i mappnamnet `file_manager_3_SCContent_<konto>`.
- Notiser: `Shared/AppGroup/<GUID>/User/<konto>/databases/nse_db.sqlite` (`ProcessedNotifications`:
  type, category, timestamp i ms) finns kvar när chatten är tömd.
- `gallery.encrypteddb` (Memories) är SQLCipher och läses inte.
- knowledgeC täckte 2026-02-04 → 2026-03-05, Snapchat-aktiviteten var augusti 2025: tystnad
  i knowledgeC är normalt för äldre filer, Snapchats egna tider får bära tidslinjen då.
- Zippens innehållsförteckning har storlek och CRC32 för varje post. Dubbletter av en fil
  hittas på 1,3 s för 494 000 poster utan att läsa en enda fil.

### Vad som byggs

1. **Katalog `queries/ios/snapchat/catalog.json`** (`SNAPCHAT_CATALOG`) med fyra databaser som
   hittas på suffix: `cache_controller.db`, `arroyo/arroyo.db`, `DocObjects/primary.docobjects`,
   `databases/nse_db.sqlite`. Synliga queries för manuell kontroll i Queries (med `-wal`), dolda
   rollqueries för Härkomst: `cache-window`, `cache-key`, `messages`, `friends`, `notifications`,
   `coverage`. Avsändar-id visas i den synliga SQL:en som hex ur `message_content`, så att
   tolkningen går att kontrollera för hand.
2. **`tools/provenance/snapchat.js`**: tolkning av `EXTERNAL_KEY`, typkoderna, protobuf-läsning
   (avsändare, medienyckel, användarnamn), och händelser till tidslinjen: cachad fil, inspelning,
   meddelande skickat/mottaget/läst, notis. Alla händelser bär databas, tabell, kolumn och query.
3. **`tools/provenance/copies.js`**: "Var finns filen?" Alla poster i zippen med samma storlek
   och CRC32 som filen, bekräftade med SHA-256, med platsens betydelse (DCIM, CPLAssets,
   Snapchat-cache, SMS-bilaga, bildväljaren, appbehållare …). `ZipRead.scan` ger `keep` även
   storlek och CRC32, så att bara träffarna sparas.
4. **Flödet i Härkomst**: filnamnet söks som förut i Photos/MediaStore. Ingen rad → filen söks
   på namn i hela zippen, och ligger den i Snapchats cache byggs bedömningen på Snapchats
   register: ny filtyp *Snapchat-media utanför bildbiblioteket*, T = `CREATION_TIMESTAMP_MILLIS`.
   Man kan också **välja filen från disk**: storlek och CRC32 räknas och zippen söks igenom.
5. **Faktorerna** för Snapchat-filer: app = Snapchat skrev själv i sitt register vid T (och
   knowledgeC om det täcker); kamera = inspelning (typ 34) eller mottagen via chatt (typ 3, annan
   avsändare). Hypotesen formuleras därefter: "skapades med Snapchat på den här telefonen" eller
   "togs emot i Snapchat på den här telefonen från @konto".
6. **Spårbarhet** som förut: händelser med källa, källor med CRC32/SHA-256 för databas och
   `-wal`, och SQL-bilagan längst ned. Protobuf-tolkade värden märks "protobuf, fält 2.1" i
   källkolumnen. Allt Snapchat-relaterat märks **beta** i gränssnittet och i protokollet.

### Inte med

- Dekryptering av chattmedia med nyckel och IV ur arroyo (möjligt senare steg).
- Memories (SQLCipher). Android-Snapchat (ingen extraktion att kontrollera mot).
- Flera Snapchat-konton i samma behållare: första träffen används, det står i statusraden.

### Testdata för Snapchat-flödet (2026-10-29)

Knappen **Testdata: Snapchat (beta)** fyller Härkomst med `snapchatScenario()` ur `sample-data.js`: videon Anna spelar in med Snapchats kamera 14:38:16 (6 min 46 s efter IMG_4104.JPG) och skickar till Erik. Den har ingen rad i Photos.sqlite, så filnamnet är cachenyckeln, T kommer ur `cache_controller.db` (MEDIA_CONTEXT_TYPE 34, EXTERNAL_KEY `<uuid>~1`) och kopiorna ligger i `recorded_videos` och appens `Library/Caches`. Faktorerna blir Skapandetid, Snapchat igång, Snapchats kamera, Skärm och Position, och hypotesen "förenligt med att filen skapades med Snapchat på den här telefonen". Samma telefonlogg och samma Snapchat-register som i kamerascenariot, så de två knapparna berättar en sammanhängande historia. I samma vända: grannbilder ur biblioteket visas även för filer utanför biblioteket, och Snapchats behållar-GUID:er (ur var databaserna hittades) gör att `Library/Caches` i Snapchats behållare märks som Snapchat i "Var finns filen?".
