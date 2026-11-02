Automatiskt byggd från commit `{{SHA}}`.

## Nytt i 1.38

- **Queries är en arbetsbänk.** Databaserna och deras queries står i en lista till vänster, grupperade per operativsystem och app. Med en extraktion öppen står zippens databaser först, och resten ligger under **Inte i extraktionen**. Sökrutan överst hittar en query på namn eller beskrivning, till exempel "sha" eller "bilagor".
- **Kör query står högst upp,** på samma rad som Från, Till och sökvärdet, med Spara CSV, Visa på karta och Bedöm i Härkomst bredvid. Enter i ett fält kör queryn. Resultatet kommer direkt under.
- **Tidsspannet står kvar** när du byter query eller databas i samma flik, så du kan pröva flera queries mot samma tid. Byter du query i samma databas behålls filerna och den inlästa databasen.
- **Källan på en rad** längst ned i queryrutan: vilken databas och `-wal` som används och ur vilken zip, och om nyckeln kommer ur extraktionen. Nyckelrutan visas bara när nyckeln saknas, eller efter **Annan nyckel…**.
- **SQL, Spårbarhet och Om databasen** är flikar under resultatet. Spårbarhet visar källan, CRC32 och SHA-256 för senaste körningen och öppnas av sig själv om CRC32 inte stämmer. Om databasen visar beskrivningen, sökvägen, källan och var databasen ligger i zippen.
- **Photos.sqlite:** iOS-versionen väljs med knappar i listan. Queryn och filen ur zippen står kvar när du byter version.

## Nytt i 1.37

- **Signal i Härkomst och Queries (beta).** Signals databaser på Android är krypterade. Med nyckeln ur extraktionen (`extra/Secrets/secrets.json`) eller en inklistrad nyckel läses de i minnet; zippen ändras inte.
- **Filen mot Signals bilagor.** Filens SHA-256 jämförs med varje bilaga, både originalet före Signals omkodning och den lagrade filen. En bild ur galleriet kopplas till meddelandet den skickades i, en sparad bild till avsändaren och tiden. Den nya faktorn **Signal** och raden Signal i tidslinjen visar resultatet.
- **Signals logg** visar när en fil valdes ur galleriet, när en bild togs med Signals kamera och när en bilaga sparades, vidarebefordrades eller raderades för alla.
- **Hashsökningen hittar Signals bilagor**, också de som bara finns krypterade i Signal.
- **Queries för Signal:** meddelanden, bilagor med SHA-256, sökning på SHA-256, kontakter, konversationer och loggen.
- **Rättat: App igång och Skärm när usagestats slutar före T.** Telefonen skriver usagestats till disk med 20–30 minuters mellanrum, så loggen kan sluta före T. En app som var öppen när loggen slutade räknades då som igång ända fram till T, och skärmen som tänd. Nu slutar intervallen där loggen slutar. Använde en app kameran vid T (appops), eller gjorde användaren något i en app vid T enligt appens egen logg (till exempel sparade en bilaga ur Signal), räknas appen som igång och skärmen som tänd, och raden säger varifrån det kommer.
- **Kortare texter** i Härkomst.
- **Queries får bättre plats.** **Kör i appen** ligger bredvid query-valet, resultatet direkt under över hela bredden och SQL:en sist. Databasens beskrivning och sökväg står överst; källa och noter är ihopfällda, och rutan "Så här gör du" är borttagen. Vyn har inget tak på bredden längre, och långa sökvägar bryts inom sin ruta.
- **Tumnaglar i vallistorna.** Alla rader får tumnagel när de syns, inte bara de första 30 eller 60, och videor får en bildruta. På Android används telefonens egna tumnaglar (`Pictures/.thumbnails` och `Movies/.thumbnails`), som också står i filkortet med sökväg och SHA-256, som på iOS.
- 343 tester (342 godkända, 1 överhoppat), även med TZ=UTC. Provkört i appen mot en labbtelefon (Android 13, Signal 8.33) och en verklig extraktion (Signal 8.10). Zipparna läses bara.

## Nytt i 1.36

- **Sök på hashsumma i Härkomst.** Skriv en MD5, SHA-1 eller SHA-256 i filnamnsrutan, en eller flera (med komma, mellanslag eller en per rad, eller rader ur md5sum). Zippens innehållsförteckning har bara CRC32, så filerna läses och hashas: bild- och videofilerna först, sedan filerna utan ändelse (många appars cache) och sist resten, tills summan hittas. Alla kopior med samma innehåll listas. Hittas summan inte har alla filer lästs, och svaret säger hur många. I en iOS 26-extraktion på 8,9 GB hittades en kamerabild på 4 s, och en summa som inte fanns var genomsökt på 72 s. Summor som redan räknats läses inte om. Filkortet, protokollet och listan för Word visar summan du sökte på bredvid filens egen. Heter en fil exakt som summan, som Snapchats cachefiler, bedöms den filen.
- **Sammanfatta positionerna.** Med rutan **Sammanfatta positionerna** blir positioner i följd inom 100 m i minst 5 minuter en vistelse, ritad som en ring med första och sista tid och antal. Mellan vistelserna visas en position var 250:e meter eller var 5:e minut, så att vägen syns. Bildens position och telefonens positioner närmast före och efter T visas alltid. I en extraktion blev 1 939 positioner vid ±24 timmar 4 vistelser och 19 enskilda positioner. Tabellen och exporterna följer läget, och alla positioner står kvar under Händelser med källa.
- **Rättat: positionerna kring T kunde saknas.** Queryn för telefonens positioner tog bara de 500 första i fönstret. Vid ±24 timmar fanns det fler, och positionerna kring T försvann: den närmaste positionen blev 2–17 timmar före bilden, fast det fanns positioner sekunder från T. Positionsfaktorn jämförde då med fel position. Nu läses alla positioner i fönstret, och faktorn jämför bara positionerna i fönstret runt T, inte dem i fönstret när filen kom till telefonen. Samma gräns togs bort för grannbilderna (300) och Snapchats register (500 och 2 000), så att sökningen på tid nu väljer de 200 närmaste bland alla bilder i fönstret.
- **Rättat: Tillbaka till listan försvann.** När en rad i listan hade flera filer med samma namn och vallistan visades, försvann **← Tillbaka till listan**, **Föregående** och **Nästa fil** tills en fil var vald. Nu ligger raden ovanför vallistan och syns hela tiden, så att man kan gå tillbaka eller vidare utan att välja.
- 326 tester (325 godkända, 1 överhoppat), även med TZ=UTC. Provkört i appen mot en iOS 26-extraktion och två iOS 18-extraktioner. Zipparna läses bara.

## Nytt i 1.35

- **Raden högst upp.** I Härkomst, Queries och EXIF & karta visar en rad högst upp extraktionen (namn, storlek, iOS- eller Android-version) med **Öppna**, **Byt** och **Stäng**, och filen du tittar på. Inne i appen öppnas och stängs extraktionen där; Härkomst och Queries har inte längre egna knappar för det. Ett byte i raden gäller alltid vyn du står i.
- **Vandra mellan vyerna med filen.** **Visa i EXIF & karta** läser filen ur zippen och visar alla EXIF-taggar och positionen. Från Härkomsts lista går alla filerna dit med **Visa listan i EXIF & karta**. **Bedöm i Härkomst** letar upp en fil från EXIF & karta i extraktionen och bedömer den. I Queries bedömer **Bedöm filerna i Härkomst** filnamnen i resultatet (`ZFILENAME`, `_display_name`) som en lista.
- **Faktorerna säger vad de prövar.** Varje faktor har en fråga, till exempel "Stämmer filens egna tider med varandra?", ett svar i klartext ("Tiderna stämmer", "Kameran användes") och vad svaret betyder för hypotesen. Lägena heter **Förenligt**, **Inte förenligt**, **Saknas** och **Upplysning** i stället för stöd och motsägelse, på korten, i tidslinjen, i protokollet och i listan.
- **Tiderna i Skapandetid skrivs ut.** "Skapad 00:49:54, tillagd i biblioteket 00:49:55: 1 s efter", "Tiden i själva bildfilen (EXIF) är …: samma sekund som Skapad" och "Kameramodellen i bildfilen … är densamma som i databasen" i stället för förkortade jämförelser.
- **Alla tider i zippen.** Zippens tider läses ur både UT-fältet (ändrad, och i vissa verktygs zippar också senast läst och skapad) och NTFS-fältet (ändrad, senast läst och skapad i UTC, som vissa extraktionsverktyg skriver i stället för UT-fältet). Förut lästes bara ändringstiden, och utan UT-fält bara DOS-tiden utan zon. Filkortet, protokollet och "Var finns filen?" visar tiderna med vilket fält de kommer ur, och Skapandetid jämför filsystemets skapandetid med Skapad.
- **Filsystemets tider i EXIF & karta.** En fil från disk visar skapad, ändrad, senast läst och ändrad metadata. Tiderna läses innan filen läses in, så att åtkomsttiden är den från när filen valdes. Tiderna följer med i JSON-exporten.
- **Komma i filnamnsrutan.** Rubriken och exemplet visar att flera filnamn kan skrivas med komma emellan.
- **Rättat: MediaStore-rader utan tid.** En rad helt utan tid stoppade bedömningen med "no such column: Infinity". Nu bedöms den med en varning.
- Provkört i appen mot labbzippen (Android 13), en iOS 26-extraktion och en iOS 18.5-extraktion. Zipparna läses bara.

## Nytt i 1.34

- **Flera filer på en gång.** Klistra in filnamn i Härkomst, ett per rad, välj flera filer från disk, eller tryck **Bedöm alla** efter en sökning på tid. Varje fil bedöms med samma kod som en ensam fil och får en rad i listan: tumnagel, fil och plats, T, typ, faktorerna som färgade prickar och om undersökaren har bedömt filen. Ett klick öppnar den vanliga vyn med **Föregående**, **Nästa** och **Tillbaka till listan**. Zippen och databaserna är redan inlästa, så det går fort: 28 filer i en iOS 26-extraktion tog 4,5 s.
- **Undersökarens bedömning per fil.** Texten och bockarna i Kontrollerad sparas för varje fil. De finns kvar när du går till nästa fil och tillbaka, och även om zippen stängs och öppnas igen, så länge programmet är öppet.
- **Listan för Word.** **Kopiera listan för Word** och **Spara listan som HTML** ger en rad per fil med typ, faktorer, programmets sammanvägning och undersökarens bedömning. Sökväg, MD5 och SHA-256 per fil står i en egen tabell, och filer som inte är bedömda märks. Varje fil har dessutom sitt eget protokoll som förut.
- **Flera träffar och filer som saknas.** Ett namn som finns på flera ställen öppnas med samma vallista som för en ensam fil, och valet sparas på raden. Ett namn som inte finns står kvar i listan med förklaringen. Byts fönstret eller tidszonen görs listan om.
- **Extraktionen följer med.** En zip som öppnas i Härkomst finns i Queries när du går dit, och tvärtom. Zippens namn står under versionen i sidopanelen. Visar Härkomst en bedömning eller en lista, eller använder en flik i Queries en databas ur en annan zip, byts inget bort: en rad erbjuder bytet med en knapp. Stängning följer samma regel, och testdata i Härkomst står kvar.
- **Appens namn i stället för GUID.** På iOS heter appbehållare och appgrupper nu efter appen, till exempel `TikTok (com.zhiliaoapp.musically)`, läst ur behållarens metadata. Det gäller i listan, i "Var finns filen?" och i protokollet. På Android står appens namn bredvid paketnamnet.
- **Rättat: filer med bara DOS-tid i zippen.** En fil utanför bildbiblioteket utan EXIF-tid kunde inte bedömas när zippen bara angav DOS-tid, fast sökningen på tid hittade den. Nu blir T zippens ändringstid tolkad i den valda zonen, och protokollet säger det.
- Provkört i appen mot en riktig iOS 26-extraktion och labbzippen (Android 13). Zipparna läses bara.

## Nytt i 1.33

Rättningar efter en genomgång av Härkomst, Queries och Time Converter.

- **Tom `-wal` stoppar inte längre läsningen.** En `-wal` på 0 byte, det vanliga läget efter en checkpoint, gav felet "Tom -wal-fil" i både Härkomst och Queries. Nu läses databasen som den är, och raden WAL i protokollet säger att `-wal` var tom.
- **EXIF-tid med rätt sommartid.** En EXIF-tid utan zon räknades om med den förskjutning som gäller i dag, inte den som gällde vid T. En sommarbild som undersöktes på vintern kunde därför hamna en timme fel och ge en falsk motsägelse i Skapandetid. En zon som bara fanns som namn, till exempel ur Snapchats Memories, räknades som UTC. Nu räknas tiden om med zonen och sommartiden vid T.
- **Undersökarens bedömning hör till filen.** Undersökarens text och bockarna i Kontrollerad följde med till nästa fil med samma namn, i en annan zip eller på en annan rad i databasen. Nu töms de när filen eller extraktionen byts.
- **Inga blandade extraktioner.** Att öppna en annan zip, välja testdata eller klicka på en annan rad medan en bedömning pågick kunde blanda två extraktioner i samma protokoll. Knapparna är nu spärrade tills bedömningen är klar.
- **Byte av tidszon eller fönster gör om bedömningen.** Förut hände ingenting förrän man körde igen, och exporterna fick den gamla zonen. Nu görs samma bedömning om direkt, och undersökarens text, bockarna och platsen på sidan står kvar. Ett byte medan en bedömning pågår görs när den är klar.
- **Varje flik i Queries har sin egen zip.** När Härkomst öppnade en query från en annan zip visade de äldre flikarna den nya zippens namn och databaser, fast de körde mot sin egen. Nu visar varje flik sin egen extraktion, och en ny flik får den zip som är öppen.
- **Grannbilder på Android med rätt källa.** Källan stod som `files → [object Object]` i Händelser med källa och i Word-tabellen. Nu står det `files → datetaken`.
- **Okänd iOS-version.** Saknades `SystemVersion.plist` i zippen valdes Photos-queryerna för iOS 17 och senare utan att det sades. Nu väljs de efter databasens egna tabeller och kolumner (`ZGENERICASSET`, `ZASSET`, `ZIMPORTEDBYBUNDLEIDENTIFIER`), och varningarna i protokollet säger att versionen saknades och hur queryerna valdes.
- **Begripliga fel när versionen skiljer sig.** En query som inte hittar en tabell eller kolumn ("no such column") förklaras: för MediaStore att queryerna kräver Android 11 eller senare, för Photos.sqlite att iOS-versionen bör kontrolleras. Om knowledgeC, routined eller Wellbeing inte går att läsa stoppas inte längre hela bedömningen. Det blir en varning, och faktorn säger att källan inte kunde läsas.
- **usagestats som inte kan läsas nämns.** Dagsfiler i XML (Android 9 och äldre) eller utan `mappings`-filen hoppades över utan ett ord. Nu står det bland varningarna varför de inte lästes.
- **Före eller efter.** Skapandetid skrev "Tillagd … efter Skapad" även när filen lades till före Skapad. Nu står det rätt ord, och när Skapad ligger efter Tillagd förklaras vad det kan bero på.
- **Ingen påhittad sluttid.** När två intervall för samma app slogs ihop tappades att det sista saknade slut, och förklaringen kunde då ange en tid då appen lämnades som inte står i loggen.
- **Var finns filen? med Zip64.** Kopior vars storlek bara står i zippens Zip64-fält missades. Nu jämförs den riktiga storleken.
- **Queries: MediaStore på Android 11 och senare.** Databasen under `providers.media.module/` kallades "annan plats än den vanliga". Nu står det "mediemodulen, Android 11 och senare".
- **Time Converter: tydliga datum.** `2026-10-31 14:30` lästes tyst som lokal tid men `2026-10-31` som UTC, och `01/02/2026` blev 2 januari. Nu gäller en zon i texten (`Z`, `UTC`, `+01:00`). Utan zon antas datorns zon och det står vilken, och datum som `01/02/2026` avvisas med en förklaring.
- Provkört i appen mot en riktig iOS 26-extraktion och labbzippen (Android 13), och mot påhittade databaser med äldre scheman (Photos.sqlite utan `SystemVersion.plist`, MediaStore från Android 10). Zipparna läses bara.

## Nytt i 1.32

- **Från Härkomst till Queries.** Varje källa under Nyckelhändelser och varje query-id under Händelser med källa är en länk när en extraktion är öppen, och Spårbarhet har knappen **Kör i Queries** per query. Queries öppnar samma zip, väljer samma databas med `-wal` pålagd och kör exakt den SQL som Härkomst körde, med tidsfönster och värden ifyllda, och visar raderna. Bredvid varje tidskolumn står tiden i UTC, omräknad på samma sätt som i Härkomst, så att raderna går att jämföra direkt; råvärdet står kvar. Spara CSV får SQL:en, sökvägarna och hasharna överst som förut.
- **Flikar i Queries.** En query från Härkomst öppnas i en egen flik, så att det man redan har uppe finns kvar. Samma query två gånger visar den flik som redan finns. **+ Ny flik** öppnar startsidan, och varje flik behåller sin databas, query, SQL och sitt resultat när man byter. Extraktionen är gemensam för alla flikar.
- **Tabeller för Word.** **Kopiera tabellen för Word** under Nyckelhändelser (raderna som visas, alltså närbilden eller alla) och under Händelser med källa. Tabellen får en rubrikrad med fil, T, tidszon och zip, och källan som databas → tabell → kolumn, till exempel `Photos.sqlite → ZASSET → ZLATITUDE, ZLONGITUDE`, så att läsaren kan kontrollera varje rad. Protokollets händelsetabell är samma tabell.
- **Nyckelhändelser med hela källan.** Källan står nu med kolumnerna, som i Händelser med källa. Raderna Tillagd och Ändrad anger sin egen kolumn (`ZADDEDDATE`, `ZMODIFICATIONDATE`, på Android `date_added`, `date_modified`) i stället för skapandetidens.
- **Tidslinjen: inga markörer på varandra.** Snapchat-markörer som infaller inom några sekunder läggs bredvid varandra i tidsordning. I närbilden får varje meddelande och notis en kort text ("Snap skickas", "Mottagaren öppnar den", "Notis från Snapchat"), och samma snap ur cachen och meddelandena skrivs en gång. En rad som behöver fler textrader blir högre i stället för att tappa text. Teckenförklaringen tar med Snapchats markörer (snap/meddelande, öppnad, Snapchats register, notis, den bedömda filen) och bara det som finns i bilden, på två rader när det behövs. Kamerans text står ovanför bandet.
- **Tidslinjen: det viktiga eller allt.** Närbilden skriver som standard bara ut det som gäller den bedömda filen och läget vid T: filens egna tidpunkter, Snapchats händelser för just den filen, inspelningen vid T, den närmaste positionen och Snapchat-händelsen i kolumnen Vid T. Grannbilder, andra snappar och andra inspelningar ritas bleka utan text, och teckenförklaringen säger hur många de är; de står kvar i Nyckelhändelser och i tooltip. Reglaget **Det viktiga / Allt** vid närbilden skriver ut allt, och exporterna får det läge som visas. Text i ett band skrivs inte längre under T-pricken.
- **Queries: underrubriker.** Startsidan delar iOS och Android i **Operativsystemet** och **Snapchat (beta)**, och rullistan med databaser har samma grupper.
- **Bedömningsflöden och Vanliga artifacts.** Bildfil — härkomst är omskrivet kring Härkomst: vad programmet läser i varje steg, Snapchat, usagestats och appops, och ett nytt steg om att kontrollera källorna i Queries, bocka Kontrollerad och kopiera tabellerna. Vanliga artifacts har rätt sökväg till routined, usagestats som protobuf, appops och Snapchats databaser på iOS och Android. Okänd app och Krypto pekar på de nya funktionerna.
- Provkört mot en riktig iOS 26-extraktion: role-file och role-app-usage körda i Queries från Härkomst med samma rader som i Härkomst, flikar öppnade, återanvända och stängda. Zippen läses bara.

## Nytt i 1.31

- **Härkomst på Android, med Snapchat (beta).** Samma bedömning som på iOS, byggd och provkörd mot en labbtelefon (OnePlus Nord, LineageOS 13 / Android 13, Snapchat 14.30) där vi själva tog bilderna och vet vad som hände när.
- **App, skärm och lås ur usagestats.** Androids egen logg i `data/system_ce/<användare>/usagestats/` (protobuf, version 5 med `mappings`, version 4 med strängpool) läses direkt ur zippen: app i förgrunden (ACTIVITY_RESUMED/PAUSED/STOPPED), skärmen tänd och släckt, låst och olåst. Den ersätter Digital Wellbeing, som saknar skärm och lås och bara finns på vissa telefoner. Avkodningen gav exakt samma händelser som `dumpsys usagestats` på labbtelefonen. Dagsfilen skrivs när telefonen tömmer loggen, så de sista minuterna före extraktionen kan saknas; protokollet säger när filen senast skrevs.
- **Kameran per app ur appops.** Androids sekretesslogg `data/system/appops/discrete/` (binär XML, ABX) säger vilken app som använde kameran, när och hur länge: en grön rad Kamera även för appar med egen kamera, som Snapchat. Avkodningen är identisk med telefonens `abx2xml`. Loggen behåller cirka sju dagar, och kameran på betyder att kameravyn visades, inte att en bild togs; det står i förklaringen.
- **Snapchat på Android.** Sex databaser under `data/data/com.snapchat.android/databases/`: `cache_controller.db` och `arroyo.db` har samma tabeller som på iOS (avsändaren står dessutom i klartext i `sender_id`, och `created_on_device` säger att meddelandet skapades på telefonen), `main.db` ger vännernas användarnamn, `client_notifications.db` notiserna, **`memories.db`** säger när en sparad snap togs (`snap_capture_time`), med fram- eller bakkamera, tidszon och position, och `journal.db` när Snapchats filhanterare lagrade en story eller en sparad snap. Allt i -wal som vanligt.
- **Bilder som Snapchat sparar till galleriet** (`DCIM/Snapchat/Snapchat-<tal>.jpg`, `.mp4`) saknar `datetaken` och EXIF-tid. T blir då `date_added` (när filen lades till i galleriet), tydligt märkt, och raden i Memories som sparades i samma sekund kopplas till filen: tagningstiden blir en egen markering, kameran bedöms vid tagningstiden, positionen ur Memories visas på kartan, och tidszonen tas ur Memories. Sammanvägningen blir "förenligt med att bilden togs med Snapchats frontkamera på den här telefonen och sparades till galleriet".
- **Mottagen chattmedia på Android.** En fil i Snapchats cache med nyckeln `chat_snap-<id>` kopplas till sitt meddelande i `arroyo.db` via id:t i protobufen, så att avsändaren och läst-tiden följer med och kameran markeras som inte tillämplig.
- **Filkortet** visar appen som skrev filen när den står i EXIF `UserComment` eller MP4 `description` (Snapchat skriver sin user agent där, base64-kodad).
- **Queries:** sex nya Snapchat-databaser för Android med synliga queries för manuell kontroll, samma mönster som iOS. MediaStore-queryn för bilder kring en tidpunkt tar nu också filer utan `datetaken`.
- **Testdata: Snapchat på Android (beta).** En tredje testdataknapp: selfien Anna tar med Snapchats frontkamera på en Android-telefon och sparar till galleriet, med Memories, usagestats och appops påhittade i samma form som labbtelefonens, så att hela Android-flödet och protokollet går att se utan extraktion.
- **Tidpunkten skrivs på svenskt vis.** Sökningen på tid har två textfält, datum `ÅÅÅÅ-MM-DD` och klockslag `TT:MM` eller `TT:MM:SS` i 24-timmarsformat, i stället för webbläsarens datumväljare med amerikansk ordning. Klockslaget får utelämnas: bara ett datum söker hela dygnet i vald tidszon, i tidsordning, utan fönstret. En rad under fälten säger hur det inskrivna tolkas innan man söker ("Tolkas som hela dygnet 2026-10-31 i Europe/Stockholm"), punkt går lika bra som kolon (`14.30`), och klistrar man in "2026-10-31 14:30" i datumfältet delas det upp på de två fälten. Amerikansk ordning (`10/31/2026`) och datum som inte finns avvisas med en förklaring.
- Android-versionen läses ur `usagestats/version` och står i rubriken och protokollet. Aperture (LineageOS kamera) och DCIM/Snapchat är kända platser.
- Kvar: batterihistoriken (`battery-history/0.bin`, som också har kameran) läses inte, usagestats i XML (Android 9 och äldre) läses inte, och ingen positionslogg läses på Android.

## Nytt i 1.30

- **Tidslinjen: en rad per jämförelse.** Fil, App, Kamera, Skärm, Lås, Position och Snapchat är egna rader (de som har något att visa). Ett band i radens färg betyder på (kameran igång, skärmen tänd, telefonen olåst), ett grått band av, ingenting ingen registrering. T är en kolumn genom alla rader med en prick där den korsar ett band: fylld för på, vit för av. Till höger står kolumnen **Vid T** som säger läget per rad i klartext, med faktorns ord (Stöd, Motsägelse, Saknas, Upplysning) som på faktorkorten: "Kamera i förgrunden sedan 14:30:59 (31 s)", "tänd sedan 14:29:25", "4 m från bilden, 40 s före T". Både översikten och närbilden har kolumnen, och båda följer med i exporterna som förut.
- **Filen visas.** Nytt avsnitt **3. Filen** med bilden eller videon som bedöms, sökväg i zippen, storlek, ändringstid, CRC32, **MD5**, SHA-256 och de viktigaste EXIF-fälten (tagen, tidszon, kamera, objektiv, programvara, mått, filtyp, position). Hela EXIF-listan finns som förut i protokollet och i EXIF & karta. HEIC-bilder och videor, som inte kan avkodas i appen, visas med telefonens egen JPEG-tumnagel ur `PhotoData/Thumbnails/V2/…/5005.JPG`, märkt som miniatyr och med egen sökväg och SHA-256, så att den inte tas för originalet. Knappen **Dölj bilden** stänger av visningen.
- **Bilden i exporterna bara på begäran.** Rutan "Ta med bilden i protokollet och förklaringen" är avkryssad från början. Ikryssad läggs bilden förminskad (längsta sidan 480 px) under "1. Filen" i protokollet och överst i förklaringen, med en rad om att det är telefonens miniatyr, bilden förminskad eller en bildruta ur videon. Sökväg, hashar och EXIF står alltid i protokollet, och MD5 står nu bredvid SHA-256.
- **Rätt fil när flera heter lika.** Vallistan för flera rader med samma filnamn har tumnagel, storlek och CRC32 per rad, hämtade ur zippen, så att valet görs på innehåll och inte bara på datum. Vallistan för poster i zippen (filer utanför biblioteket och fil från disk) har tumnagel för bildfiler.
- **Sök på tid.** Man vet när filen borde ha skapats men inte vad den heter: ange en tidpunkt under filnamnet och tryck **Sök filer kring tidpunkten**. Bilderna i bildbiblioteket skapade inom fönstret listas närmast först, med tumnagel och avståndet från tidpunkten, och under dem filer i zippen utanför biblioteket (bild, video, Snapchats cache) med ändringstid i fönstret. Tidpunkten tolkas i tidszonen i rutan (datorns zon eller UTC). Zippar utan unixtid per post tolkas på DOS-tiden i samma zon och märks "zon okänd". Klicka på en rad så bedöms den.
- Avsnitten i resultatet är omnumrerade: 3. Filen, 4. Underlag för bedömning, 5. Tidslinje och förklaring, 6. Positioner, 7. Var filen finns.
- Provkört mot en riktig iOS 26-extraktion: HEIC-bild med telefonens tumnagel, MD5 och SHA-256, tidsökning med tumnaglar på alla träffar, och mot båda testdataknapparna. Zippen läses bara, som förut.

## Nytt i 1.29

- **Undersökaren gör bedömningen.** Avsnittet heter nu "Underlag för bedömning". En stående rad säger att programmet sammanställer telefonens registreringar och säger vad de är förenliga med, och att den slutliga bedömningen gör undersökaren. Programmets mening är märkt "Programmets sammanvägning". Ny ruta **Undersökarens bedömning**: texten följer med under egen rubrik i både protokollet och förklaringen, och lämnas rutan tom står det "Ej ifylld". Rutan töms när en ny fil bedöms.
- **Tidslinjen omarbetad.** Översikten har fem rader i stället för sju: Fil, Appar (kameran grön, andra appar blå), Snapchat, Telefon (skärm och lås hopslagna till ett band med tillståndet i klartext: "tänd, olåst", "släckt, låst") och Position. En blå ruta i översikten visar var närbilden ligger.
- **Närbild runt T.** En andra bild visar en tiondel av fönstret åt varje håll (±90 s vid ±15 min, minst ±30 s) med händelserna utskrivna direkt på bilden: filens tidpunkter, apparnas start och slut, snappar med användarnamn, telefonens tillstånd och positionen med avstånd från bilden. Texter som inte får plats staplas på två rader eller skrivs till vänster om markören, aldrig ovanpå varandra.
- **Nyckelhändelser.** Under bilderna visas bara raderna inom närbilden, var och en med sin källa (databas och ström eller tabell). **Visa alla N rader** fäller ut resten. Förklaringen för Word får som förut alla rader.
- **Båda bilderna i exporterna.** Protokollet och förklaringen får översikten och närbilden för varje fönster, och knappen Spara bild finns för var och en.
- **Kontrollerad per faktor.** Varje faktorkort har en ruta **Kontrollerad** som undersökaren bockar i efter egen kontroll mot källan och SQL:en. Räknaren vid Undersökarens bedömning visar "2 av 5 faktorer kontrollerade". Protokollet skriver per faktor "Undersökarens kontroll: kontrollerad <klockslag>" eller "ej kontrollerad", och båda exporterna får meningen "Undersökaren har kontrollerat N av M faktorer mot källorna: …". Bockarna nollställs när en ny fil bedöms.
- **Stora extraktioner.** Zippens innehållsförteckning läses från disk en gång när extraktionen öppnas och hålls sedan i minnet, så att sökningen efter filen, kopiorna och Snapchats poster går mot minnet i stället för att läsa om förteckningen fyra till fem gånger per körning. Statusraden visar antal poster och förteckningens storlek. Förteckningar över 512 MB läses från disk som förut. Själva zippen läses fortfarande aldrig i sin helhet, och ingenting skrivs.
- Nya färger på tidslinjen, kontrollerade mot varandra för färgblindhet och mot vit bakgrund, med mörkare grön och blå så att texten i staplarna går att läsa.

## Nytt i 1.28

- **Härkomst, beta: filer utanför bildbiblioteket.** Finns filnamnet inte i Photos.sqlite söks hela zippen. Ligger filen i Snapchats cache byggs bedömningen på Snapchats egna register: tiden då Snapchat registrerade filen, om den spelades in med Snapchats kamera, skickades till någon eller togs emot från någon, och när den lästes. Avsändare och mottagare visas med användarnamn ur Snapchats kontotabell.
- **Snapchat i tidslinjen för alla filer (beta).** Cachade snaps, skickade och mottagna meddelanden, lästa snaps och notiser i fönstret, med databas, tabell, kolumn och SQL i protokollet. Fyra Snapchat-databaser läses med `-wal`: `cache_controller.db`, `arroyo.db`, `primary.docobjects` och `nse_db.sqlite`.
- **Var finns filen? (beta).** Alla poster i zippen med samma storlek och CRC32 som filen, bekräftade med SHA-256, med platsens betydelse: bildbiblioteket, iCloud-original, Snapchats cache, SMS-bilaga, bildväljaren, en apps behållare. Hittas ur innehållsförteckningen på någon sekund även i en zip med en halv miljon poster.
- **Välj filen från disk.** En fil man fått från annat håll jämförs byte för byte med allt i extraktionen. Träff i bildbiblioteket bedöms som vanligt, träff i Snapchats cache ur Snapchats register.
- **Testdata: Snapchat.** En andra testdataknapp i Härkomst visar hela Snapchat-flödet utan extraktion: videon som Anna spelar in med Snapchats kamera på samma promenad i Stockholm och skickar till Erik. Filen ligger bara i Snapchats cache, så filnamnet är cachenyckeln, tiden kommer ur `cache_controller.db`, Snapchat-raden i tidslinjen visar inspelningen, sändningen och att mottagaren öppnade den, och "Var filen finns" visar kopiorna i `recorded_videos` och appens `Library/Caches`. Protokollet får Snapchat-queryerna i samma ordning som en riktig körning.
- **Bilderna i biblioteket runt tidpunkten** visas nu även när den bedömda filen ligger utanför biblioteket, till exempel en bild som sparades i Bilder strax efter en snap.
- **Snapchats egna behållare känns igen** i "Var finns filen?": en kopia i Snapchats `Library/Caches` märks som Snapchat, inte som en okänd appbehållare, eftersom behållarens GUID är känd från var Snapchats databaser hittades. Saknas bildbibliotekets databas i zippen söks filnamnet direkt i hela zippen.
- **Queries:** fyra nya Snapchat-databaser (beta) med synliga queries för manuell kontroll. Avsändar-id visas som hex ur protobufen, så att tolkningen går att kontrollera för hand.
- Allt Snapchat-relaterat är kontrollerat mot en enda extraktion (iOS 18.5) och märkt beta i gränssnittet och protokollet.

## Nytt i 1.27

- **Positioner i Härkomst.** Ny ruta med en tabell över positionerna runt bilden: bildens position enligt Photos.sqlite, bildens position enligt EXIF i själva filen och telefonens positioner ur routined (GNSS och Wi-Fi) i fönstret. Varje rad har tid, latitud, longitud, noggrannhet, avstånd från bildens position och källa med databas, tabell och kolumner.
- **Karta med nålar.** Samma kartvy som i Positioner, med nålar och noggrannhetsringar. Bildens nål är röd och har en bubbla med tiden. **Spara kartbild** ger en rapportbild med norrpil, skalstock och kartdatakälla. Punkter som ligger några meter från varandra visas som en klunga ("3 st") tills man zoomar in, som i Positioner.
- **Ny faktor: Position.** Telefonens position närmast i tid jämförs med bildens. Inom 100 m, eller två gånger noggrannheten om den är större, är stöd. Över 1 km är motsägelse. Däremellan en upplysning om möjligt GPS-fel. EXIF-positionen jämförs med databasens. Har filen ingen position står det som upplysning, och saknas routined står faktorn som saknas med orsak. Alternativet "mottagen" får avståndet som skäl.
- **Kartbilden följer med i båda exporterna**: i protokollet under "Positioner" tillsammans med tabellen, och i förklaringen under "Var telefonen var". Hämtningen har tio sekunders tidsgräns. Hinner kartan inte ritas går exporten vidare utan kartbild, och statusraden säger det.
- **Fyll med testdata** har fått en EXIF-position, så att tabellen, kartan och positionsfaktorn syns utan extraktion.
- Kartvyn kan nu lämna ut sin bild till andra verktyg, dölja menyn och zooma in tills nålarna skiljs åt. Kartfel skrivs till konsolen i stället för att försvinna.

## Nytt i 1.26

- **Nytt verktyg: Härkomst.** Öppna extraktionen och ange ett filnamn, så byggs en tidslinje runt den tid då bilden skapades: skärm tänd, telefonen låst eller olåst, vilka appar som var igång och om kameran var igång, ur Photos.sqlite, knowledgeC, routined och själva bildfilen i zippen (EXIF med ExifTool). `-wal` läses alltid med.
- **Typ av fil först.** Kamerabild, skärmdump eller sparad ur en app avgörs ur databasen, och faktorerna bedöms därefter. För en Snapchat-bild bedöms om Snapchat var igång, eftersom systemkameran inte syns i loggen då. För en skärmdump är kameran inte tillämplig.
- **Stöd, motsägelse eller saknas** per faktor, med en sammanfattning som alltid säger "förenligt med" eller "inte förenligt med", aldrig en slutsats. Tystnad i loggarna redovisas som saknas, med strömmens täckning utskriven. Alternativa förklaringar (mottagen, synkad, sparad ur app, skärmdump, redigerad) listas med vad som talar för och emot.
- **Två exporter för Word.** *Protokoll* med varje rad: databas, sökväg i zippen, CRC32, SHA-256 för databas och `-wal`, antal WAL-ramar och exakt SQL. *Förklaring* i vanlig svenska för den som inte är tekniker: klockslag och vad som hände, inga källor. Båda kopieras till urklipp som Word-tabeller, eller sparas som HTML. Tidslinjen går att spara som bild.
- **Grannar och två fönster.** Bilderna som togs runt omkring och de närmaste i nummerordning visas. Kom filen till telefonen långt efter att den skapades byggs en andra tidslinje för den tidpunkten.
- **Fyll med testdata** i Härkomst visar samma promenad i Stockholm som i EXIF & karta, med bilden IMG_4104.JPG tagen mitt i en Snapchat-session.
- **Queries:** iOS 18 och senare saknar `/app/inFocus` i knowledgeC. Appar och kamera kommer ur `/app/usage`, som finns och loggar kameran. App-ID har fått namn på iOS-systemtjänster som dyker upp där.
- Android bedöms ur MediaStore och Digital Wellbeing. Skärm och lås saknas där, och Android-delen är oprövad mot en extraktion med bilder.

## Nytt i 1.25

- **Öppna en extraktion.** Välj extraktionens zip-fil i Queries, så hittar appen själv databaserna och deras `-wal`: Photos.sqlite, routined Cache.sqlite, knowledgeC, interactionC, MediaStore och Digital Wellbeing. Klicka på en databas och kör queries som vanligt.
- **Zippen ändras aldrig.** Den läses bara, bit för bit, och inget packas upp eller sparas på disk. Fungerar med stora zippar (Zip64). En zip på 22 GB med 568 000 filer gås igenom på under en sekund.
- **Ändras zippen efter att den valts** vägrar appen läsa och ber dig välja den igen.
- **Rätt Photos-queries väljs själv.** iOS-versionen läses ur telefonens `SystemVersion.plist`.
- **Spårbarhet:** extraktionens namn, storlek och ändringstid, sökvägen i zippen, CRC32 och SHA-256 för databasen och `-wal` står i resultatet och i CSV-filen.
- **Startsidan i Queries** märker vilka databaser som finns i den öppnade extraktionen.

## Nytt i 1.24

- **Kör queryn i appen.** Välj databasen och dess `-wal` under **Kör i appen**. Filerna läses bara. Ramarna i `-wal` läggs på en kopia i minnet fram till sista giltiga commit, och appen visar hur många ramar som lades på och SHA-256 för båda filerna. Fungerar för alla databaser i Queries.
- **Spara CSV** ger alla rader. Överst står filnamn, hash, vad som hände med `-wal` och SQL:en.
- **Visa på karta** skickar resultatet till Positioner som en egen källa, med noggrannheten som cirkel.
- **Ny databas: Cache.sqlite (routined).** Telefonens positioner från GNSS och Wi-Fi i ett tidsspann, med valbar noggrannhet, och besök med ankomst, avfärd och hur länge. Besök ritas som områden på kartan.
- **Tidsspannet står som datum och tid i SQL:en**, med tidszon, i stället för sekunder. Ett datum utan klockslag tar med hela dagen.
- **Android MediaStore:** kolumnen heter `datetaken`. Filsökningarna gav tidigare felet "no such column" på nyare Android.
- **EXIF** skriver aldrig till källfilen, inte heller tidsstämplarna. Tidigare ställdes tiderna tillbaka efter läsning på macOS och Windows, vilket ändrade ctime och tappade nanosekunder. På macOS och Windows kan systemet fortfarande uppdatera åtkomsttiden. Stora bilder visas nu också.
- **Positioner:** CSV-importen klarar fält inom citattecken, kolumner som slutar på `_utc` räknas som UTC, och osäkerhet läses som noggrannhet.
- **Kartan:** lagren läggs inte längre till två gånger vid snabba byten av bakgrund, och tider utan zon kallas inte längre UTC i tidsreglaget.
- **Säkerhet:** en webbsida kan inte längre laddas i ett verktygs ram och få tillgång till filer.

## Nytt i 1.23

- **Bakgrund: Karta, Satellit och Hybrid.** Lägg en bildkarta (flygfoton eller satellitbilder i `.pmtiles`-format) i mappen `maps`, eller välj den med **Lägg till bildkarta…**. Bilderna läses lokalt och ingenting hämtas från nätet. Hybrid lägger vägar och namn ovanpå bilden.
- **Nål i Google Maps-stil.** Välj **Prick** eller **Nål** under **Punkter** i kartpanelen. Nålen har källans färg, numret i huvudet och växer och krymper med zoomen.
- **Spara bild** ger en bild för rapporter: norrpil, skalstock, när bilden skapades, kartans mittpunkt och kartdatakällan.
- **Tidsreglaget** ritar rutten fram till vald tid, med en markör per rutt. Tiden visas i bevisets tidszon, och uppskattade positioner märks som inte uppmätta. Uppspelningen har hastighetsval.
- **Popupen** hamnar inte längre bakom kartpanelen.
- **Fyll med testdata** följer gatorna i Stockholm. Rutterna går inte över vattnet, och kvällen är på Södermalm.
- Kartan går snabbare med många punkter: markeringar och bubblor ritas inte om i onödan.

## Nytt i 1.22

- **EXIF** visar bilden eller videon direkt, även som tumnagel i listan. Knappen med en överstruken bild döljer dem. Filen läses bara, och tidsstämplarna lämnas som de är.
- **Alla värden, även okända** läser om filerna och tar med taggar som ExifTool annars hoppar över. Uppgifter som bara kommer från minneskopian visas inte.
- **Händelse** i bubbelredigeraren har en egen ruta, så den syns mot panelen i både ljust och mörkt läge.
- **Skift+klick i listan** markerar alla rader mellan den senast markerade och den du klickar. Ett nytt skift+klick flyttar slutet av intervallet.
- **Windows-installationen** får programmets egen ikon. Den installerade appen visar inte längre Electron-ikonen.

## Nytt i 1.21

- **HTML-kartan:** valda kartfiler behålls när filväljaren töms. Mappen `maps` och en enstaka `.pmtiles`-fil kan importeras igen.

## Nytt i 1.20

- **Positioner:** under **Rutter** skriver du första och sista punkten och trycker **Lägg till**. Fälten är förifyllda med första och sista punkten. Namnet ändrar du på raden som dyker upp. **Dölj** tar bort linjen, punkterna och numren ligger kvar.
- **Bubblor** på en källa eller rutt öppnar samma redigerare: linje till punkten, horisontell noggrannhet och vad bubblan ska visa. **Anpassa standard…** gäller punkter som inte har en egen inställning. Storleken **Mindre** / **Större** gäller alla.
- **I kartan** i listan visar bara positioner som syns på kartan just nu. Numren ändras inte.
- Tidsspannet är kompaktare. Det står vilken tid som jämförs: klockslaget som det står i källan i Positioner och EXIF, datorns tidszon i Queries.
- **Fyll med testdata** visar Anna (iPhone) och Erik (Samsung) som möts vid Sergels torg och tar taxi till Fotografiska, med rutter, bubblor och noggrannhetsringar redan på.
- Vid väldigt många punkter ritas bubblor för det som syns, och listan visar de första träffarna. EXIF skickar inte med miniatyrer till Positioner om det är fler än 50 bilder.

## Nytt i 1.19

- **EXIF:** **Karta** och **Till Positioner** öppnar Positioner. Bilderna som syns just nu blir källan **EXIF-bilder**, så att de kan visas tillsammans med GPS-spår. Samma knapp igen uppdaterar källan i stället för att lägga till en kopia.
- **Visa i EXIF** på en bildpunkt öppnar filen i EXIF igen.
- Öppnas EXIF för sig själv, utan verktygslådan, finns kartan kvar där.

## Nytt i 1.18

- **Varje punkt har ett fast nummer** i tidsordning, samma på kartan och i listan. Numret ändras inte när en punkt tas ur rutten eller döljs.
- Under **Rutt** väljer du **Nummer på**: alla punkter, bara rutten eller inga. Punkter utanför rutten har en ljus bricka.
- **Lista** ligger uppe till höger på kartan, under zoomknapparna.
- En klunga av punkter visar till exempel **3 st**, så att den inte förväxlas med ett punktnummer.

## Nytt i 1.17

- **Kartan i skrivbordsappen** visas direkt igen när programmet startas med `npm start`.
- **Rutt:** välj själv vilka punkter som ingår, per punkt i listan eller i popupen. Punkter utanför rutten syns fortfarande på kartan.
- **Bubblor:** dubbelklicka på en bubbla, eller tryck **Bubbla** i listan, för att välja vad just den visar och i vilken ordning. Du kan byta titlar och lägga till egna rader. **Återställ alla bubblor** tar bort anpassningarna.
- Linjen till punkten ligger under miniatyrerna, börjar utanför punkten så att siffran syns och har en tydligare stil.
- **Listan:** ny sökruta. Markera alla, inga eller alla från en källa och ändra dem på en gång: med i rutten, dölj eller anpassa bubblor.
- Spela-raden täcker inte längre listan.
- **Positioner:** välj färg på varje källa. **Spara vy…** sparar källor, färger, rutt, bubblor och kartläge i en fil, och **Öppna vy…** fortsätter där du slutade. Bilder följer med som små miniatyrer. Originalfilerna ändras aldrig.

## Nytt i 1.16

- **Queries:** en standardquery fungerar utan att du fyller i något. Tomt filnamn, app eller datum betyder alla rader, inte en sökning efter tecknet `…`.
- Photos-frågorna söker inte längre i `ZORIGINALFILENAME` i WHERE-satsen. Den kolumnen saknas ofta och gjorde att frågan inte gav några träffar.

## Nytt i 1.15

- **HTML-kartan** fungerar när `Toolbox.html` öppnas som fil, till exempel på en låst dator. Välj mappen `maps`. Kartan läser filerna direkt, utan lokal server.
- Webbläsaren försöker inte längre hämta `ftmaps://` eller andra filadresser, och kartans worker startar som ett vanligt skript.

## Nytt i 1.14

- **Queries:** ny förstasida med iOS och Android sida vid sida. Varje kort visar vad databasen innehåller, var den ligger och vilken query som rekommenderas. **← Alla databaser** tar dig tillbaka.
- Alla queries för Photos.sqlite, knowledgeC, interactionC och Digital Wellbeing förklarar vad de gör, och varje databas har en förvald query.
- **Så kan resultatet se ut** visar rimliga exempel även för iOS: HEIC-filnamn, tidszon, personer, album och sluttider som stämmer med användningstiden.
- **Karta:** den valda raden i listan markeras igen.

## Nytt i 1.13

- **Queries:** varje Android-query förklarar vad den gör, och den mest användbara är förvald och märkt ★. Schema-frågor heter "Hjälp: …".
- SQL:en ligger till höger med tydligare färger i ljust och mörkt tema. Under den visas **Så kan resultatet se ut**, med kolumnerna queryn returnerar och påhittade exempelrader.
- Stegen är numrerade och knappen för att byta query är större.

## Nytt i 1.12

- HTML-zippen startar ingen lokal server. Öppna `Toolbox.html` och välj mappen `maps`. Kartan läser filerna direkt därifrån.

## Nytt i 1.11

- **Välj mappen maps** öppnar en mapp, inte en enstaka fil. På en låst dator: öppna `Toolbox.html` i Edge eller Chrome och peka ut mappen `maps`. Ingen .exe, ingen Python och ingen lokal server.

## Nytt i 1.10

- Klicka på en punkt och välj **Dölj** eller **Ta bort**. Dölj tar bort den från kartan men lämnar den i listan, där den kan visas igen.
- **Visa noggrannhet** ritar en cirkel när positionen har horisontell noggrannhet. Bubblorna kan visa samma värde.
- **Mät** avstånd med två klick. **Spara bild** sparar kartan som PNG, inklusive bubblor.
- Testdata i Positioner har miniatyrer, och några punkter har noggrannhet så att cirklarna syns.

## Nytt i 1.9

- **Lista** över positionerna, med nummer, tid, enhet och möjlighet att ta bort en punkt ur listan.
- **Bubblor** vid punkterna. Välj tid, filnamn, enhet, app, longitud/latitud eller en egen händelse. Bubblorna går att dra, göra större eller mindre, och kan få en linje till punkten.
- Punktnumren är vita i en mörk cirkel. Menyn går att dölja inför en bild.
- Appnamn slås upp från metadata mot App-ID. Datumfält visas som ÅÅÅÅ-MM-DD och TT:MM.
- HTML-zippen innehåller offlinekartan i mappen `maps`.

Offlinekartan från 1.7 finns kvar: världen i översikt, Sverige på gatunivå. Onlinekartan är valfri och skickar bara kartrutor.

## Windows
- **ForensicsToolbox-{{VERSION}}-Installer.exe** — installer
- **ForensicsToolbox-{{VERSION}}-Portable.zip** — portabel, packa upp och kör `Forensics Toolbox.exe`

## HTML-mapp (ingen .exe)
- **ForensicsToolbox-{{VERSION}}-html.zip** — packa upp, öppna `Toolbox.html` och välj mappen `maps`. Offlinekartan ligger redan där. Ingen server behövs.

## Linux
- **ForensicsToolbox-*.AppImage** — körbar AppImage (x64)

## macOS
- **ForensicsToolbox-*.dmg** / **.zip** — osignerat bygge. Gatekeeper kan varna; högerklicka och välj Öppna.

Kartdata © OpenStreetMap-bidragsgivare (ODbL), via Protomaps.
