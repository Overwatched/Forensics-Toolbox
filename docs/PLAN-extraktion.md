# Plan: peka på en extraktion

Användaren väljer en extraktion. Appen hittar själv de databaser som Queries har queries för,
tar med deras `-wal` och kör queryn utan att något packas upp på disk. Källan läses bara,
aldrig skrivs.

Status: byggt i `tools/db-queries/zip.js`, `locate.js` och `extraction.js`. Katalogerna har fått
`paths`, och Photos-banden har fått `ios`. Släppt i 1.25.

## Vad extraktionerna i K123456-26 visar

| Extraktion | Storlek | Poster | Komprimering | Sökvägar i zippen |
|---|---|---|---|---|
| iPhone, iOS 18.7.7, `EXTRACTION_FFS.zip` | 22 GB | 568 526 | ingen (stored) | `filesystem1/private/var/...` |
| Pixel 9, `..._files_full.zip` | 15 GB | 30 070 | ingen (stored) | `/data/data/...` (inleds med `/`) |
| Solflare, UFED-mapp | 19 GB | – | – | bara rapporter och `.ufdx`, ingen filsystemsdump |

Slutsatser:
- **Zip64 krävs.** Båda zipparna är större än 4 GB.
- **Okomprimerat i praktiken.** Posterna är okomprimerade, så en databas är en sammanhängande bit
  av zippen och kan läsas direkt. Deflate ska ändå stödjas, eftersom andra verktyg komprimerar.
- **Prefixet före sökvägen varierar** (`filesystem1/`, `/`, inget). Därför jämförs sökvägen bakifrån,
  och prefixet som träffade sparas.
- **Flera träffar kan vara riktiga.** Det finns till exempel två Photos.sqlite: `PhotoData` och
  `Syndication.photoslibrary`. Alla träffar visas, och den vanliga markeras.

## Hur det fungerar

Allt sker i Queries-sidan med `File.slice()`. Webbläsaren kan läsa valfri bit av en 22 GB-fil
utan att läsa in resten.

Det ger tre fördelar:
- **Ingen ny brygga.** Det behövs ingen ny IPC och ingen ny brygga i `preload.js`, så det blir
  inga nya säkerhetsfrågor.
- **Fungerar i båda versionerna.** Det fungerar i skrivbordsappen och i HTML-versionen.
- **Bara läsning.** Filen öppnas av webbläsaren för läsning. Inget skrivs, och inga tider ändras.

Flödet:
1. **Välj fil.** "Öppna extraktion…" väljer zip-filen.
2. **Läs innehållsförteckningen.** Zippens innehållsförteckning (central directory) läses bakifrån,
   inklusive Zip64. Den läses i bitar och bara poster som matchar en känd sökväg sparas. För 568 526
   poster blir det några tiotal MB att gå igenom en gång, med en förloppsindikator.
3. **Visa listan.** En lista visas: databas, sökväg i zippen, storlek, ändringstid, om `-wal` finns,
   och vilken katalog och query den hör till.
4. **Läs databasen.** Användaren väljer en rad. Databasen och `-wal` läses ut till minnet. CRC32 i
   zippen kontrolleras, och SHA-256 räknas på innehållet.
5. **Kör queryn.** Därifrån är det samma väg som "Kör i appen" i 1.24: WAL läggs på, queryn körs,
   och resultatet går att få som CSV eller på kartan.

## Zippen får aldrig ändras

Det här är det viktigaste kravet. Ingen byte i zippen får ändras, och inte heller dess storlek
eller ändringstid.

**Hur det säkras i koden:**
- **Bara läsning.** Zippen nås bara via `File` från en vanlig filväljare (`<input type="file">`) och
  `File.slice()`. Det är ett API som bara kan läsa. File System Access API
  (`showOpenFilePicker`, `createWritable`) används inte, och inte heller någon brygga till
  huvudprocessen.
- **Bitarna ändras aldrig.** Allt som läses ut kopieras till minnet innan det används. WAL läggs på
  en kopia, som `wal.js` redan gör i 1.24. Det som körs är `sql.js` mot en kopia i minnet, aldrig mot
  filen.
- **Inget sparas bredvid zippen.** Inga index, cachar eller sidofiler skrivs i zippens mapp. Ett
  sparat index (se del 6) ligger bara i minnet under sessionen.
- **Test som vaktar.** Ett test grep:ar `zip.js`, `locate.js` och `extraction.js` efter skrivande API:er
  och misslyckas om de dyker upp: `createWritable`, `showOpenFilePicker`, `forensicsMedia`,
  `ipcRenderer`, `fs.`.

**Hur det kontrolleras:**
- **Enhetstest.** Zip-läsaren körs mot en Buffer som jämförs byte för byte före och efter.
- **Provkörning i Electron.** Provkörningen görs mot K123456-26 i Electron, en gång under
  utvecklingen. Före och efter hela flödet (öppna, lista, köra queries, CSV, karta) jämförs:
  - SHA-256 för hela zippen;
  - storlek, `mtime` och `ctime` på nanosekunden.
- **SHA-256 bara vid provkörningen, aldrig i appen.** Hash av hela zippen görs bara vid
  provkörningen under utvecklingen. Appen räknar den aldrig. Med 100 GB tar det minuter på SSD och
  kan ta upp mot en timme på nätverksdisk eller USB-disk.
- **I vardagen räcker storlek, `mtime` och `ctime`.** Varje skrivning till filen ändrar `mtime` och
  `ctime`, och `ctime` kan inte sättas tillbaka av ett vanligt program. Hashen behövs för att
  bevisa att innehållet är detsamma. Den hashen har användaren redan från extraktionsverktyget och
  kan jämföra mot den vid behov.
- **Lätt kontroll i appen.** Chromium sparar storlek och ändringstid när filen väljs. Om filen
  ändras efteråt vägrar Chromium att läsa den. Då avbryter appen med ett tydligt fel som ber
  användaren välja zippen igen. Det gäller till exempel om en kopiering fortfarande pågår.
  Extraktionens storlek och ändringstid står också i CSV-huvudet.
- **Åtkomsttiden (`atime`) redovisas ärligt.** Ett operativsystem kan uppdatera den när en fil läses.
  Den ligger i filsystemet, inte i zippen, och påverkar inte innehållet eller hashen. Det mäts och
  skrivs in i dokumentationen hur macOS, Windows och Linux beter sig.
- **Rekommendation i hjälptexten.** Kör mot en arbetskopia, eller mot en skrivskyddad volym
  eller fil, enligt vanlig rutin. Appen ändrar inte filen, men det skyddet ska inte hänga på appen.

## Delar

### 1. Kända sökvägar i katalogerna
- **Nytt fält `paths`.** Varje databas i `catalog.json` får ett maskinläsbart fält `paths`, en lista
  med sökvägar utan prefix, till exempel `private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite`.
  Fältet `dbPathHint` blir kvar som text till användaren.
- **Android.** `/data/data/` och `/data/user/0/` räknas som samma sak, och `/data/user/10/` m.fl.
  visas som en annan användare. MediaStore har två paketnamn (`com.android.providers.media` och
  `...media.module`).
- **Test.** Testet kräver att varje databas med `runnable` har minst en sökväg.

### 2. Zip-läsare (`tools/db-queries/zip.js`, UMD, testas i Node)
- **Läser bakifrån och följer Zip64.** EOCD → Zip64 EOCD locator → Zip64 EOCD. Därefter
  central directory i bitar om ungefär 4 MB.
- **Lokala huvudet läses om.** Datan börjar efter lokala huvudet, och dess längder kan skilja sig
  från central directory.
- **Okomprimerat och deflate.** Okomprimerade poster läses direkt. Deflate packas upp med
  `DecompressionStream('deflate-raw')`. Andra metoder och krypterade poster ger ett tydligt fel.
- **Kontroll.** CRC32 kontrolleras mot zippen. Fel CRC visas som en varning och stoppar inte.
- **Indata.** Läsaren tar en funktion `read(offset, length)` → `Uint8Array`, så att samma kod kan
  testas med en Buffer i Node.
- **Storleksgräns.** En databas på över ungefär 1,5 GB läses inte, eftersom sql.js har hela
  databasen i minnet. Det ger ett tydligt besked. Alla filer i K123456-26 är under 10 MB.

### 3. Hitta databaserna (`tools/db-queries/locate.js`, testas i Node)
- **Matchning.** Namnen i zippen jämförs bakifrån mot `paths`. `-wal`, `-shm` och `-journal`
  kopplas till sin databas.
- **Varningar.** En databas utan `-wal` får en varning om att poster kan saknas. Det gäller även
  när en `-journal` finns, eftersom innehållet då kan vara mitt i en transaktion.

### 4. Gränssnitt i Queries
- **Ny ruta "Extraktion".** Rutan ligger ovanför "Kör i appen". Den har knappen "Öppna extraktion…"
  och en förloppsindikator. Listan är grupperad per katalog: Photos, routined, knowledgeC m.fl.
- **Välja en rad.** När användaren klickar på en rad väljs rätt databas i rullistan och filerna
  läggs in i "Kör i appen". Användaren väljer sedan query som vanligt och trycker Kör.
- **Ingen kopia på disk.** Inget kopieras till disk. Knappen "Spara kopia av databasen…" kan komma
  senare, med SHA-256 i filnamnet eller i en sidofil.

### 5. Spårbarhet i CSV och rapport
- **Huvudet i CSV-filen.** Huvudet får nya rader:
  - extraktionens filnamn och storlek;
  - postens sökväg i zippen, ändringstid och CRC32;
  - SHA-256 för databasen och för `-wal`.
- **Ingen SHA-256 på hela zippen.** Spårbarheten bygger på storlek och ändringstid för zippen,
  CRC32 och SHA-256 för posterna som lästes ut. Det går att jämföra mot hashen från
  extraktionsverktyget.

### 6. Tester och provkörning
- **Testfiler skapas i testet.** Testerna skapar egna zippar i Node: okomprimerade, med deflate och
  med Zip64-poster. Zip64 kan provas med ett konstgjort huvud utan att skapa en fil på 4 GB.
- **Provkörning mot K123456-26.** Hela flödet körs på iPhone- och Pixel-zipparna. Resultaten ska
  stämma med de uppackade kopiorna från 1.24-provkörningen, till exempel 1073 rader för 2026-09-26.
- **Tidsmätning.** Det mäts hur lång tid det tar att läsa innehållsförteckningen för 568 526 poster.
  Om det tar för lång tid kan resultatet sparas per fil (namn + storlek + ändringstid) under sessionen.

## Ordning

1. Del 1 och 2, med enhetstester.
2. Del 3, och provkörning mot K123456-26 från kommandoraden.
3. Del 4 och 5: gränssnitt och CSV-huvud.
4. Provkörning i Electron mot båda zipparna, och en kontroll att zippens tider inte ändras.

## Inte med i första versionen

- **Uppackad mapp.** `webkitdirectory` räknar upp alla filer, vilket är tungt med 500 000 filer.
  Skrivbordsappen kan göra det billigare genom att bara titta på de kända sökvägarna, men det kräver
  IPC och en egen säkerhetsgenomgång.
- **Andra format.** `.tar` (vanligt från andra verktyg), UFDR, `.ufdx` och krypterade containrar
  kommer inte med nu.
- **Alla databaser i extraktionen.** Det betyder att hitta alla SQLite-filer, även de som saknar
  queries.

## Beslut

- **Bara zip.** Mappar, `.tar` m.fl. tas inte med.
- **Zippen får aldrig ändras.** Se avsnittet ovan.

## Gränssnitt (byggt)

- **Startsidan.** Rutan "Öppna en extraktion" ligger överst. Efter att en zip har öppnats:
  - visas tabellen med de databaser som hittades;
  - får korten nedanför märkningen "I extraktionen", och övriga kort tonas ned med texten
    "Finns inte i extraktionen";
  - använder ett klick på ett märkt kort databasen ur zippen.
- **Arbetsytan.** Under "1. Databas" listar rullistan databaserna i extraktionen, med
  "Annan databas, filerna läses in för hand…" sist. Under listan står zippens namn, storlek och
  iOS-version, och länken "Stäng extraktionen". Katalogens rullista visas bara när filerna läses
  in för hand eller när iOS-versionen är okänd.
- **"Så här gör du".** Steg 1 blir "Databasen och -wal är hämtade ur …zip".
- **"Kör i appen".** Texten om filval döljs. Knappen heter då "Använd andra filer i stället…".
- **Spårbarheten.** Källa, CRC32 och SHA-256 ligger i en hopfällbar del under resultatet. Den
  öppnas av sig själv om en CRC32 inte stämmer.
- **Exemplet "Så kan resultatet se ut".** Det döljs när det finns ett riktigt resultat.

## Provkörning 2026-10-23

- **Extraktionerna i K123456-26.** Hittade databaser:
  - iPhone-zippen: 5 databaser. Photos.sqlite finns två gånger (PhotoData och Syndication), och
    dessutom routined `Cache.sqlite`, `knowledgeC.db` och `interactionC.db`. iOS 18.7.7 lästes ur
    `SystemVersion.plist`, så Photos-bandet för iOS 17 och senare valdes automatiskt.
  - Pixel-zippen: `external.db`, som visas två gånger (MediaStore och Kamera), och Wellbeing
    `app_usage`.
- **Tid.** Innehållsförteckningen gicks igenom på 0,4 s för 568 526 poster (117 MB) och på 0,0 s
  för 30 070 poster.
- **Samma resultat som ur uppackade kopior.** Alla 50 körningar mot samma databaser gav samma
  antal rader som i provkörningen av 1.24, till exempel 4670 positioner och 12 besök i routined.
  SHA-256 för `Cache.sqlite` och `-wal` ur zippen är samma som för filerna som packades upp med `unzip`.
- **Zipparna ändrades inte.** SHA-256, storlek, `mtime` och `ctime` var exakt lika före och efter
  hela flödet (83 query-körningar). Även `atime` var oförändrad på macOS (APFS).
- **Ändrad zip upptäcks.** En zip som ändras efter att den valts ger felet "kunde inte läsas …
  Välj den igen". Det gäller både när filen växer och när en byte skrivs om på plats.
