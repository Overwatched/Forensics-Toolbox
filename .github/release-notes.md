Automatiskt byggd från commit `{{SHA}}`.

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
