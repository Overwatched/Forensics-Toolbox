Automatiskt byggd från commit `{{SHA}}`.

## Nytt i 1.62

**Härkomst: snabbare med många filer.** Det som gäller hela extraktionen görs nu en gång, i stället för en gång per fil. Underlaget och protokollet är desamma som förut.

- **Sökningen i zippen:** ett filnamn slås upp direkt i zippens innehållsförteckning. Förut gicks alla poster igenom, flera gånger per fil.
- **Frågor som inte beror på filen**, till exempel alla bilagor och kontakter i en chattapp, körs en gång per extraktion. Protokollet listar dem fortfarande för varje fil.
- **En fil som redan är läst** läses inte om i ExifTool. Ett klick på en rad i listan räknar om bedömningen ur det som redan är läst.
- **Listan** ritar bara raden som blev klar, inte hela tabellen för varje fil.
- **Uppmätt** på en iPhone-extraktion med 634 000 poster i zippen: en lista med 3 070 filnamn, varav 3 000 inte finns i extraktionen, gick från 245 sekunder till 18. Ett klick på en rad i listan gick från 0,5–1,1 sekunder till omkring 0,1.
- **Kvar:** en fil som inte lästs förut tar omkring 0,2 sekunder, och det mesta av den tiden är ExifTool. En lista med tusentals filer tar därför fortfarande tid första gången.
- **Provat:** enhetstesterna, röktestet i appen och html-versionen i Chrome på macOS. Underlaget jämfördes före och efter ändringen för 104 filer ur två labbtelefoner, en iPhone och en Android, och var detsamma.
- **Inte provat:** en lista med tusentals filer som finns i extraktionen. Windows och Linux provas först i bygget.

## Nytt i 1.61

**Laboration: bygg ditt eget flöde.** Förbered är nu en byggare. Flödet sätts ihop av färdiga mallar och egna steg, genom att klicka eller dra dem på plats.

- **Byggstenar** står till vänster: mallar, egna mallar, eget steg, ny grupp, väntan och enskilda steg. Ett klick lägger byggstenen vid märket i flödet, och den går också att dra dit. Listan går att söka i, och rubrikerna går att fälla ihop.
- **Märket** visar var nästa byggsten hamnar. Ett plus mellan två steg flyttar det dit. Stegens koder räknas om när något läggs till, flyttas eller tas bort.
- **Grupper:** en mall blir en grupp av steg med en rubrik. En grupp kan byta rubrik, app och riktning mellan enheterna, kopieras, flyttas och tas bort.
- **Drag:** ett steg går att dra inom en grupp och till en annan grupp, och en hel grupp går att dra. Allt som går att dra går också att göra med knappar.
- **Egna mallar:** en grupp eller ett steg sparas som en egen mall under Mina mallar. Mallarna ligger kvar på datorn när programmet stängs, och de kan sparas som en fil och öppnas på en annan dator.
  - En egen mall som används i ett flöde följer med i flödets fil.
  - I html-versionen sparas mallarna per webbläsare och mapp. Filen är sättet att flytta dem.
- **Ångra:** knappen Ångra eller Ctrl+Z (Cmd+Z på macOS) tar tillbaka den senaste ändringen, upp till 50 ändringar.
- **Saker att se över:** flödet varnar när något inte går ihop, till exempel ett steg som läser ett meddelande som inget steg har skickat, eller ett steg som slår på en enhet som inte har stängts av. Varningarna hindrar inte att laborationen startas.
- **Färdigt upplägg:** det tidigare sättet, att bocka i appar och delar och få alla steg på en gång, finns kvar bakom en knapp och visas när flödet är tomt.
- När laborationen har startat är flödet låst, som förut.
- **Provat:** enhetstesterna, röktestet i appen och html-versionen i Chrome på macOS. Röktestet drar ett steg, en grupp och en mall på plats, ångrar, sparar en egen mall och ser att den ligger kvar efter omstart. Layouten är provad med mycket långa namn, smala fönster och fem typsnitt.
- **Inte provat:** att egna mallar ligger kvar efter en uppdatering av ett installerat program, utskriftsdialogen i appen och inklistring i ett dokument. Windows och Linux provas först i bygget.

## Nytt i 1.60

WhatsApp och Telegram på Android (beta) i Queries, Chattar och Härkomst, byggt mot en laboration med två telefoner. Härkomst har också en ny regel för filer som togs emot i en chattapp, och den gäller också iOS.

- **Queries:** WhatsApps `msgstore.db` (meddelanden, mediefiler, kvitton, raderat för alla, chattar och gruppmedlemmar) och `wa.db` (kontakter och namn), och Telegrams `cache4.db` (meddelanden, media, chattar och användare).
  - Telegrams text och avsändare står inuti meddelandets blob och läses bara i det format som fanns på labbtelefonen. En annan version av appen kan ge rader utan text, och raden säger då att formatet är okänt.
- **Chattar:** WhatsApp och Telegram på Android visas som de andra apparna. En bild i Telegram visas som en rad utan fil.
- **Härkomst, WhatsApp:** en fil kopplas till sitt meddelande på tre sätt, och faktorn säger vilket: filens SHA-256 är den skickade eller mottagna filens, filens SHA-256 är originalets till det som skickades, eller filen ligger på meddelandets sökväg under WhatsApps mapp.
  - En SHA-256 som inte finns som fil i zippen söks i WhatsApps databas. Så hittas en fil som togs emot men aldrig hämtades till telefonen.
  - En kamerabild som skickats som dokument får en upplysning: att den skickades säger inget om hur den skapades.
  - Meddelandena står i tidslinjen, och databaserna, frågorna och appens version står i protokollet.
- **Härkomst, Telegram:** bara Telegrams egen bildfil kopplas till sitt meddelande, på bildens id i filnamnet, och filens storlek jämförs med den som står i meddelandet.
  - Andra filer får "Ingen koppling": Telegram kodar om bilder som skickas och sparar ingen summa. Det betyder inte att filen aldrig skickades där, och det står i faktorn.
- **Ändrat i Härkomst, alla chattappar på iOS och Android:** för chattappens egen kopia av en mottagen fil är en släckt skärm eller en annan app i förgrunden nu en upplysning, inte en motsägelse. På labbtelefonen sparade WhatsApp en mottagen bild med släckt skärm och utan app i förgrunden.
  - Förut gav en annan app i förgrunden sammanfattningen "inte förenligt" för en sådan fil. Gör om bedömningen i ett äldre protokoll om den vilar på det.
  - Bara WhatsApp på Android är kontrollerat. En skickad fil bedöms som förut.
- **Provat på labbtelefonen** (Samsung, Android 16): nio filer i Härkomst gav den koppling som laborationens steg säger, en hashsökning genom hela zippen (26,6 GB, drygt 3 minuter) hittade summan i WhatsApps databas, och konversationerna visades i Chattar och Queries. Enhetstesterna, röktestet i appen och html-versionen i Chrome på macOS gick igenom.
- **Inte provat:** WhatsApp Business, WhatsApps äldre mapplayout, originalets summa för en bild vald ur galleriet, och medietyper som inte fanns i laborationen. I Telegram: skickade bilder, video, dokument, filer sparade till galleriet, kanaler, hemliga chattar och andra versioner av appen. Regeln från filnamn till bildens id bygger på en enda bild. Windows och Linux provas först i bygget.

## Nytt i 1.59

**Laboration.** Ett nytt verktyg i listan till vänster för den som gör en egen laboration: ett flöde av steg, en klocka medan stegen görs, och en tabell till protokollet som säger när en åtgärd gjordes, vad den var och på vilken enhet.

- **Förbered:** namnge enheterna, välj appar att chatta i och bocka i standardflöden. Skapa stegen gör hela flödet, och varje steg går sedan att ändra, flytta och ta bort. Egna steg kan läggas till.
  - Standardflödena: klockorna i början och i slutet, text, medier, grupp, raderat meddelande och samtal i varje vald app, kamera och skärmdump, en app i förgrunden, lås och avstängning, och tidszon.
  - Varje steg får en kod, till exempel L07. Den skrivs i meddelandet eller syns i bilden av datorns skärm, så att spåret i enheten kan knytas till raden i tabellen.
  - Flödet kan sparas som en fil och öppnas på en annan dator, och stegen kan skrivas ut som en lista med en ruta för klockslaget.
- **Genomför:** ett steg i taget med stor kod och datorns klocka. Mellanslag säger att steget är gjort, H hoppar över, A tar en anteckning, Backsteg ångrar och V avbryter en väntan.
  - Före start är mellanslag ett övningstryck som inte sparas.
  - T märker det senaste trycket som för sent. Tiden står då som ungefärlig i tabellen.
  - Under en väntan, till exempel fem minuter med låsta enheter, räknas inga tryck.
  - Läget sparas efter varje tryck, så laborationen fortsätter där den var efter en omstart.
- **Tabell:** Tid, Enhet, Åtgärd, Kod och Anmärkning, med datum, klocka, tidszon och enheter ovanför. Den kan kopieras till ett dokument, skrivas ut eller sparas som PDF, och sparas som CSV med en kolumn i UTC.
  - Tiden på en rad är när undersökaren tryckte, inte när enheten gjorde något. Den går inte att ändra efteråt, bara märka som ungefärlig och ge en anmärkning.
  - Ett överhoppat steg står som inte utfört. Ångrade tryck räknas ovanför tabellen och står i loggen.
  - Loggen sparas som en fil och går att öppna igen.
- Verktyget läser ingen extraktion, och ingenting lämnar datorn.
- **Provat:** enhetstesterna, röktestet i appen och html-versionen i Chrome på macOS, och layouten med mycket långa namn, smala fönster och tre typsnitt. Kopieringen gav en tabell och text i urklipp i Chrome.
- **Inte provat:** utskriftsdialogen i appen, inklistring i ett dokument, och en hel laboration med telefoner. Windows och Linux provas först i bygget.

## Nytt i 1.58

En rättning i Chattars telefonvy.

- **Rättat: platsen i chatten vid bytet mellan Lista och Telefon.** Mitt i en chatt kunde meddelandet som fönstrets överkant skar hamna helt ovanför kanten vid bytet, så att vyn började ett meddelande senare. Nu skärs meddelandet på samma ställe i båda utseendena.
  - Inget meddelande saknades eller visades fel, och exporten berördes inte.
  - Felet fanns i 1.57 på alla plattformar: i den långa påhittade chatten i 50 av 160 prövade lägen. Med rättningen står samma meddelande kvar överst i 158 av 160, och i de två övriga syns mindre än en pixel av det.
- **Därför var bygget av 1.57 rött:** testet av bytet prövade ett enda läge. Det gick bra med Macens typsnitt och föll med typsnitten på Linux och Windows, i de två testjobb som inte stoppar en release. Nu ställer testet kanten nära slutet av det högsta meddelandet som syns, och det faller med 1.57:s kod också på Macen.
  - I bygget av 1.57 stannade testet vid felet, så resten av det (telefonvyns export) kördes bara på macOS.
- **Releasetexten för 1.57** skrev WhatsApps id `@lid` utan kodtecken. GitHub läste det som ett konto och visar det som medverkande i den releasen. Kontot har inget med programmet att göra. Ett test stoppar nu ett sådant namn i releasetexten.
- **Provat:** enhetstesterna, röktestet i appen och html-versionen i Chrome på macOS, och bytet med åtta typsnitt och storlekar. Windows och Linux provas först i bygget.

## Nytt i 1.57

Chattar har fått val i listan och en telefonvy. Chattar, Härkomst och Queries läser och dekrypterar en databas en gång i stället för var för sig. Ett fel som gav fel namn på kontakter i Signal på iOS sedan 1.41 är rättat.

- **Rättat: fel namn på kontakter i Signal på iOS (1.41–1.56).** Fanns det minst ett smeknamn i Signals databas fick varje kontakt det smeknamnet, också telefonens ägare. Fanns inget smeknamn fick en kontakt utan eget namn numret från en annan rad, i testet telefonens ägares.
  - Det syntes där Härkomst namnger avsändaren av ett mottaget Signal-meddelande (tidslinjen, kopplingen till en bilaga och hashsökningen) och i kolumnen `namn` i queryn Kontakter.
  - Kolumnerna `telefon` och `aci` var rätt. Chattar och queryerna för meddelanden och konversationer hade inte felet.
  - Gör om bedömningen eller queryn i ett äldre protokoll om namnet på en Signal-kontakt spelar roll.
- **Listan i Chattar:** knappar för app och slag med antalet vid varje, tre ordningar och Dölj tomma. Listan ritar 200 rader åt gången per databas.
  - Sökrutan letar i namn, nummer och deltagare, inte i meddelandenas text. Ett nummer hittas hur det än är skrivet: "070-000 01 25" hittar +46700000125. En grupp hittas genom en deltagare, och raden säger vem.
  - Ett nummer hittas bara om databasen har det, så ingen träff betyder inte att numret saknas i appen. Har Signal på iOS bara kontaktens id (ACI) hämtas numret ur Signals kontakter. En WhatsApp-konversation med bara ett id (`@lid`) hittas på namnet: på labbtelefonen står numret i WhatsApps LID.sqlite, som inte läses än.
- **Databaserna läses en gång:** nästa verktyg får en kopia ur minnet av det som läste och dekrypterade databasen först.
  - Protokollet och spårbarheten säger vilket verktyg som läste databasen och när. Ett verktyg med en annan nyckel, eller utan, får aldrig ett annat verktygs dekryptering.
  - Med en påhittad extraktion (314 MB krypterad Signal på iOS, 600 000 meddelanden) och Chattar öppnat först tog första bedömningen i Härkomst 1,7 s i stället för 3,8–4,0 s och första queryn i Queries 0,2 s i stället för 2,3–2,4 s. Chattar räknar Signals konversationer på 0,3 s i stället för 1,0 s.
- **Härkomst som såg ut att fastna på Signal:** raden stod kvar på "Dekrypterar signal.sqlite (Signal)… 99 %" medan frågorna mot databasen gick. Nu säger raden varje skede: läser, dekrypterar, söker eller väntar på ett annat verktyg.
  - Med nyckelfilen vald för hand släppte Härkomst den dekrypterade databasen vid varje besök. Samma bedömning efter ett besök i Chattar tar nu 1,1 s i stället för 3,4 s.
  - Om det var hela orsaken till det en användare mötte i 1.56 går inte att säga. Händer det igen säger raden vilket skede det står i.
- **Telefonvyn i Chattar:** Lista och Telefon över chatten byter utseende. Telefon ställer samma bubblor i en ram med en telefons bredd, på skärmen och i exporten, med två spalter per A4-sida i utskriften. Ramen följer plattformen: iOS, Android eller ingen särskild.
  - Vyn är en rekonstruktion ur databasen, inte en skärmbild, och det står i ramens fot. Ingen klocka, mottagning, batterinivå eller modell ritas: databasen säger inte vilken modell, textstorlek eller vilket tema telefonen hade.
- **Provat på labbtelefonen** (iOS, fyra chattappar, tio konversationer): sex bedömningar i Härkomst och nio queryer gav samma svar med databaserna lästa av Chattar som med egen läsning. Knapparnas antal stämde, två nummer hittades skrivna på tre sätt, och telefonvyn visade alla meddelanden i en chatt per app.
  - Felet med namnen syns inte där: Signals två kontakter får samma namn med den gamla queryn. Det är bara visat med påhittade kontakter.
- **Inte provat:** hundratals riktiga konversationer och en riktig grupp. Tiderna är mätta med påhittade data: labbtelefonens databaser är för små för att visa skillnad. Verktygen delar fortfarande en tråd, så sidan står still medan ett av dem läser, dekrypterar eller kör en stor fråga. Telefonvyns sidfot i utskrift kräver Chromium (appen eller Edge). Firefox och Safari är inte provade.

## Nytt i 1.56

**Chattar (beta).** Ett nytt verktyg i listan till vänster visar konversationerna i chattapparnas databaser som i appen.
- **Bubblorna:** egna meddelanden till höger, avsändarens namn i grupper, och bilder, video och ljud direkt i chatten. En bild förstoras med ett klick.
- **Tiderna:** klockan vid ett meddelande visar alla dess tider med kolumn, rått värde och UTC. Tiderna visas i datorns zon eller i UTC, och zonen står alltid utskriven.
- **Deltagarna** står överst.
- **Export:** hela konversationen, valda meddelanden eller ett tidsspann sparas som HTML eller skrivs ut som PDF. Källan står överst, och sist kommer en tabell med varje meddelandes id, tider och bilagor.
- **Queries:** raderna i WhatsApps meddelandefråga har knappen Chatt, som öppnar chatten vid meddelandet. Från chatten öppnas raden i Queries.
- **Signals bilagor:** de är krypterade på telefonen. Chattar dekrypterar dem, och SHA-256 för innehållet jämförs med databasen. På labbtelefonen stämde alla.
- **Stora chattar:** en chatt med hundratusentals meddelanden öppnas på ett par sekunder.
  - Den läses i omgångar. En ruta visar stegen, hur många meddelanden som är lästa och tiden, och har Avbryt. Ett avbrott lämnar det som visades.
  - Bara meddelandena runt det som syns ritas. Sök, Gå till datum, Första och Senaste når hela chatten, och träffarna märks i texten.
  - När extraktionen öppnas visar listan varje app direkt och fyller i den när den är läst. Raden överst säger vad som läses och har Avbryt.
  - Exporten byggs med förlopp och säger i förväg ungefär hur stor filen och utskriften blir. Före en mycket stor fil eller utskrift kommer en varning.
  - Mätt med en påhittad chatt på 300 000 meddelanden: 1,4 s i stället för 16 s med sidan stilla, och 51 MB minne i stället för 468 MB. Inte provat på en riktig telefon med så stora chattar.
- **Appar:** WhatsApp, Signal och Telegram på iOS, Signal på Android och Snapchat på iOS och Android.
  - Snapchats text avkodas och namnen kommer ur kontodatabasen. Snaparna ligger i Snapchats cache och visas som en rad i chatten.
  - Signals chattvy på Android är bara prövad med påhittade data. Chattar har ingen egen SQL utan läser dolda chattroller i samma kataloger som Queries, och ett test stoppar en ändring som skulle bryta chattvyn.

## Nytt i 1.55

Samsungs loggar räknas nu om med telefonens egen zon, så att sommar- och vintertid inte längre gör tider osäkra. `eRR.p` går att läsa som en tabell i Queries. En skärmdump från Samsung säger själv vilken app den visar, och det jämförs med loggarna. Releaserna här visar bara sina egna nyheter, så att filerna syns direkt.

- **Sommar- och vintertid i Samsungs loggar:** telefonens zon läses ur `persist.sys.timezone` (`/data/property/persistent_properties`). SSRM och batterihistoriken räknas om med zonens regler, varje rad med den förskjutning som gällde då.
  - Förut märktes en hel fil i batterihistoriken "tiden osäker" om den spände över ett byte, och två olika zoner i SSRM gjorde tiden mellan dem osäker. På labbtelefonen var 38 intervall, ungefär 2 500 timmar, osäkra bara av det skälet. Nu är de 0, och alla 344 zoner i loggarna stämmer med telefonens zon.
  - Vårens hopp på en timme är inte längre ett hål i SSRM. Ett byte vid en tidsrad i batterihistoriken ser inte längre ut som en klocka som ställts.
  - I timmen som går två gånger i oktober är en rad säker när raderna visar vilket varv det är. Annars märks den osäker.
  - Zonen gäller bara där loggarnas egna zoner stämmer med den. En fil som skrevs i en annan zon, till exempel på en resa, räknas som förut. Bilagan säger hur många zoner som stämmer, och filen med zonen står bland källorna.
- **eRR.p i Queries:** filen läses in som tabellen `err` i minnet, med samma tolkning som i Härkomst: radnummer, tiden som den står och i UTC, vad som hände, orsaken i klartext, krasch och fel klocka. Fyra queries: alla rader, nedstängningar och omstarter, de tre låsta dygnen före en omstart, och rader med fel klocka. En rad ur eRR.p i Härkomst öppnar Queries med raden markerad. Filen ändras inte, och summorna gäller filen som den står i extraktionen.
- **Skärmdumpar som säger sin app:** en skärmdump från en nyare Samsung har appen som syntes i en bilaga sist i filen (`Captured_App_Info`). En äldre har appens namn sist i filnamnet. Faktorn "App på skärmen" jämför den med appen på skärmen enligt loggarna vid T: samma app är Förenligt, en annan Inte förenligt. Förut var faktorn alltid en upplysning. Bilagan står på filkortet och i protokollet. På labbtelefonen anger fyra skärmdumpar Solflare, och SSRM har Solflare överst när de togs.
- **Samsungs tagningstid i filen:** kamerabilder från Samsung har tagningstiden i UTC i bilagan sist i filen (`Image_UTC_Data`). Den står nu i tabellen under Skapandetid och jämförs med tiden i EXIF.
  - Samma sekund är en upplysning, eftersom kameran skriver båda.
  - Saknar EXIF zon och skiljer de sig jämnt på kvarten, är det zonen som är fel antagen.
  - Annars går tiderna isär: bilagan följer inte med när tiden i EXIF ändras i efterhand.
  - På labbtelefonen låg den inom en sekund från EXIF på alla tre kamerabilder.
- **Kortare releaser:** varje release på GitHub visar bara sin egen versions nyheter och nedladdningen, inte hela historiken. De äldre releaserna är kortade på samma sätt.
- **Inte provat:** en telefon som rest till en annan zon, och timmen som går två gånger med riktiga rader där något hände. En bild vars tid har ändrats i galleriet, så att tiderna går isär. En Pixel 9 och iPhone sparar inte appen i skärmdumpen, så där jämför du själv bildens innehåll med appen på skärmen. Skärmdumpen med appens namn i filnamnet har ingen logg att jämföra med på labbtelefonen.

## Nytt i 1.54

Härkomst läser nu Samsungs `eRR.p`. Där skriver telefonen en rad vid varje start, omstart och nedstängning, med tid, zon och ofta skälet. Det svarar på en fråga som de andra loggarna är tysta om: var telefonen igång, och hade den låsts upp sedan start, när filen fick sin tid? Två fel som gav fel besked i 1.52 och 1.53 är rättade.

- **Faktorn "Telefonen igång":** visas när svaret säger något.
  - *Avstängd:* tiden ligger mellan en nedstängning och nästa start, och batterihistoriken täcker tiden.
  - *Inte upplåst:* telefonen var startad men hade inte låsts upp sedan starten.
  - *Kanske avstängd:* raderna säger avstängd, men batterihistoriken har ett hål där, klockan var fel, eller nästa rad är en ny nedstängning.
  - *Nära en omstart:* tiden ligger inom en minut från ett skifte.

  Avstängd och Inte upplåst är Inte förenligt för kamerabilder och skärmdumpar. För andra filer är de en upplysning, eftersom tiden i en mottagen eller kopierad fil kan komma från en annan enhet. Var telefonen igång och upplåst visas ingen faktor, men skälet säger det när loggarna är tysta.
- **Raden Telefonen i tidslinjen:** starter och nedstängningar med skälet (batteriet tog slut, vald på telefonen, uppdatering, kommando från en dator, låst i tre dygn), band för avstängd tid och lås före första upplåsningen. En omstart med skälet `device_locked_3days` ger ett lås de 72 timmarna före.
- **Skärmen tänd i veckor:** efter en omstart på laddning kan batterihistoriken visa skärmen tänd i veckor. Visar `eRR.p` att telefonen inte var upplåst, säger faktorn Skärm nu "Inte upplåst" i stället för att skärmen var tänd.
- **Mätt på labbtelefonen:**
  - Omstarter och nedstängningar ligger 6–11 s efter SSRM:s (6 av 6) och inom 15 s från batterihistorikens (13 av 13 med rätt klocka).
  - Första upplåsningen enligt batterihistoriken och enligt SSRM ligger 4–8 s isär på sex av sju starter.
  - Under sex spann före första upplåsningen, sammanlagt 183 dygn, ändrades ingen fil bland bilder och appdata.
  - Före sessionen startade telefonen 9 oktober och låstes inte upp förrän sessionen 6 november. Det är de dygnen batterihistoriken visar som tänd skärm.
- **Rättat: falskt hål vid byte mellan sommar- och vintertid.** Batterihistorikens täckning räknades i UTC, så ett byte av zon mellan två filer gav ett hål på en timme som inte fanns. Faktorerna kunde då säga att batterihistoriken saknade tiden. Nu räknas täckningen i telefonens lokala tid.
- **Rättat: Inställningar som app efter en start.** Före första upplåsningen visar telefonen en startskärm som hör till Inställningar, och 1.52 och 1.53 tog det för att appen Inställningar var öppen. När `eRR.p` visar att telefonen inte var upplåst räknas den inte längre som app.
- **Källan:** varje rad ur `eRR.p` i händelsetabellen har radnummer och rårad. Protokollets bilaga har filen med CRC32, hur raderna tolkas, läget i fönstret och raderna med fel klocka.
- **Inte provat:**
  - Allt kommer från en enda telefon, och Samsung beskriver inte filen, så reglerna bygger på jämförelser med SSRM och batterihistoriken.
  - Ingen riktig bild på labbtelefonen har en tid då telefonen var avstängd, så Avstängd är bara provat med påhittade filer.
  - På äldre programvara kom startraden i labbet upp till 31 dygn efter själva starten. Då säger faktorn Kanske avstängd, om inte batterihistoriken visar starten.
  - Rader i en batterihistorikfil som spänner över bytet mellan sommar- och vintertid märks fortfarande "tiden osäker".

## Nytt i 1.53

Härkomst är jämförd med en loggad session på en Samsung. Kamera, appar och skärm stämmer med det som gjordes på telefonen, och Samsungs kamera-app syns på SSRM:s kamerarad. Sessionen visade också ett fel som funnits på all Android sedan 1.26, och det är rättat.

- **Rättat: appen försvann ur förgrunden när den bytte vy (all Android sedan 1.26).** När en app byter vy kommer stoppet för den gamla vyn en stund efter att den nya har startat, och programmet tog det för att hela appen hade stängts. Appen saknades sedan tills den bytte vy igen, så en fil skapad i ett sådant hål kunde få "Inte registrerat" under App fast appen låg öppen. Det gällde både `usagestats` och Wellbeing. I sessionen saknades förgrundsapp i 300 av 1 281 sekunder, med hål på upp till 112 sekunder. Nu säger `usagestats` och SSRM samma app i 1 259 av de 1 281 sekunderna, och skillnaderna ligger vid appbyten. Gör om bedömningen av en Android-fil i ett äldre protokoll om svaret under App spelar roll.
- **Rättat: appen bakom kameran i batterihistoriken.** 1.52 sa att `+camera` inte säger vilken app som använder kameran. Det stämmer bara för äldre rader. Nyare rader har appens uid (`+camera +state=<uid>:"camera"`), och nu läses den. Förut angavs appen i förgrunden, och när Snapchat startade kameran var det frågan om behörighet. En uid som delas av flera systemappar, eller som inte finns i filen, ger ingen app. Äldre rader anger som förut appen i förgrunden, och raden säger vilket det är.
- **Rättat: Snapchats filer och kameran.** En fil i Snapchats mappar fick "Inte registrerat" under Kamera när Snapchats register inte sa något, trots att loggarna visade Snapchats kamera. Nu är svaret "Kameran var på", med en rad per logg. Texten säger att det inte visar att just den filen togs med kameran, eftersom Snapchat startar kameran när appen öppnas.
- **Rättat: SSRM:s skärmrad.** Efter att telefonen legat låst över ett byte av tidszon, som sommartidens slut, märktes raden "tiden osäker" och räknades inte. Raderna från en start till den första tidsraden har nu den radens zon.
- **Rättat: tidslinjen.** Samma läge ur flera källor gav text ovanpå text i raderna för app, skärm och lås. Nu står texten en gång, på det längsta bandet. Filraden sa "skapas" också när tiden bara är filens ändringstid eller tiden i filen, och nu säger den vilket.
- **Kontrollerat i sessionen:** alla åtta kameraanvändningar, av kamera-appen, Signal och Snapchat, står i SSRM, batterihistoriken och `appops` med rätt app. Starten i batterihistoriken ligger inom 0,62 s från SSRM och slutet 0,55–2,17 s efter. Klockan i batterihistoriken flyttades högst 122 ms. En bild tagen med Signals kamera skiljs från en bild ur kamerarullen: bara den första har Signals kamera vid tiden. Zippen och en rapport från samma telefon ger samma svar på två äldre bilder.
- **På en andra telefon, utan loggad session:** sekunderna utan app med tänd skärm minskade från 231 till 115 av 2 517. En app låg som mest 2 sekunder kvar ovanpå en annan, så rättningen drar inte ut appar över varandra.
- **Inte provat:** rättningen av förgrundsappen är inte körd mot facit från Android 13-labbet, eftersom den zippen inte fanns till hands. Signals meddelanden i sessionen är inte lästa, eftersom nyckeln inte fanns i extraktionen. En telefon i daglig användning är inte heller provad: SSRM räcker troligen ungefär en vecka, inte tio dygn som 1.52 sa, men det är en uppskattning ur mätt radtakt.
- **Skärmen på laddning:** batterihistoriken kan visa skärmen tänd i veckor när telefonen legat på laddning, på labbtelefonen upp till 70 dygn. Raden stämmer med loggen men betyder inte att telefonen användes, och faktorn skiljer inte på det. Avstängd telefon (`eRR.p`) och Rubins positioner läses inte än.

## Nytt i 1.52

På Samsung räcker Härkomst nu mycket längre bakåt. Två av Samsungs egna loggar ger app, kamera och skärm där `usagestats` och `appops` tagit slut, och varje rad går att kontrollera i råtext.

- **App, kamera och skärm på Samsung:** SSRM-loggen (`ssrm_heating_N.log`) och batterihistoriken (`newbatterystats…`) läses ur zippen eller rapporten. På labbtelefonen räcker batterihistoriken tio månader bakåt och SSRM drygt sex, medan `usagestats` bara hade en dag. På en telefon i daglig användning räcker SSRM kortare, kanske tio dygn.
- **Provat på en riktig bild:** en kamerabild från mars fick förut "Inte registrerat" i alla tre faktorerna. Nu är den förenlig i alla tre: kameraappen i förgrunden, skärmen tänd och kameran på i 14 sekunder, med bilden mitt i det spannet.
- **Råraden syns:** i händelsetabellen och protokollet står filen, radnumren och själva raderna, till exempel `newbatterystats… rad 2699–2718 → +1h37m42s570ms (1) 081 +camera … -camera`. Bilagan har filerna med CRC32 och råraderna i fönstret.
- **Batterihistorikens klocka:** tiden där räknas fram från den senaste `TIME:`-raden, och den raden kan skrivas sent. Då ligger raderna fel tills nästa `TIME:` rättar dem, i labbet 160 sekunder. Programmet mäter stegen vid varje `TIME:`. Rader i ett sådant avsnitt, och i en fil som spänner över ett byte av tidszon, märks "tiden osäker". De står i händelsetabellen men räknas inte i bedömningen och ritas inte i tidslinjen, och faktorn säger varför. Ett steg framåt räknas bara bort när nästa rad visar att telefonen just vaknade, så hellre en rad för mycket märkt än en för lite.
- **Vilken källa som gäller:** för app och skärm gäller `usagestats` eller Wellbeing i första hand, sedan SSRM och sist batterihistoriken. Kameran står med från varje källa, eftersom oberoende källor som säger samma sak är värda att se. Faktorn har en rad per källa, förklaringen en händelse.
- **Kameran i batterihistoriken har ingen app:** den säger bara att kameran var på. Appen som nämns är den som var i förgrunden just då, och raden säger det. SSRM nämner appen som använde kameran.
- **Besked när loggen inte räcker:** en bild äldre än `usagestats` kunde få "Wellbeing finns inte i rapporten", fast `usagestats` fanns. Nu står det vad varje logg täcker, och om batterihistoriken eller SSRM har ett hål vid tiden står hålet med sina tider.
- **Rättat i tidslinjen:** kameraband från flera källor ovanpå varandra gav text ovanpå text.
- **Inte provat:** allt kommer från en enda Samsung, en telefon som mest legat oanvänd. Samsungs egen kamera-app har aldrig setts på SSRM:s kamerarad, bara Signal, så att den raden saknas säger inget. Kontrollera råraden innan du drar slutsatser av den. Avstängd telefon (`eRR.p`) och Rubins positioner läses inte än.

## Nytt i 1.51

Programmet hittar nyckeln till Signal själv, filens tider står också på filkortet, och rapporter ur extraktioner med mappen `extra/` går att läsa med nyckeln. Signal på Android är kontrollerat mot en riktig rapport, och två fel i protokollet och Signal-faktorn är rättade.

- **Filens tider under 3. Filen:** kortet har en grupp med samma tider som tabellen under 4, i samma zon och med T utmärkt. Det som saknas står kvar, till exempel "Filen har ingen egen tid", så att det inte ser ut som att filen saknar tidsstämplar. Källorna står i tabellen under 4.
- **Nyckeln hittas själv:** programmet letar under `extra/` i zippen, i rapporten och, i skrivbordsappen, bredvid zippen. Bredvid zippen avgör samma enhets-id i namnet, annars duger en enda nyckelfil utan en annan telefons id. Flera möjliga filer väljs aldrig, utan nämns. En webbläsare får inte se mappen bredvid zippen, och då sägs det. Beskedet säger alltid var nyckeln lästes eller var programmet letade.
- **Reserven:** **Nyckelfil…** och en inklistrad nyckel går alltid före det programmet hittat. En vald nyckelfil gäller bara extraktionen den valdes för och följer inte längre med till nästa telefon. `…_android_keystore.zip` går att välja som nyckelfil och tas inte längre för själva extraktionen om den väljs tillsammans med zippen.
- **Krypterad nyckelring:** nyckelringen under `extra/KeychainDump/` har varje post krypterad, och den avvisades förut. Nu dekrypteras den i minnet, och bara värdet i Signals post läses. Provat på två riktiga iPhone-extraktioner med 1 496 poster, där varje kontrollsumma stämmer. Ingen av telefonerna har Signal, så Signals post i den formen är bara provad med testdata och den riktiga nyckeln från en annan extraktion, inpackad på samma sätt.
- **Rapporter ur en zip med `extra/`:** nyckelfilerna ligger högst upp i sådana rapporter, så programmet hittade dem inte och sa att nyckeln saknades. Nu läses de, och de står inte längre bland telefonens filer. De här rapporterna har också ctime på iPhone, och den visas i tabellen.
- **Provat på två rapporter:** iPhone-rapporten ger samma resultat som zippen den kom ur: samma rader i alla 38 queries, och samma T, tider och svar på 89 filer. ctime och de andra tre tiderna stämmer på alla 287 919 filer. Zippen till Android-rapporten finns inte att jämföra med, men 34 queries och 14 filer gick igenom utan fel.
- **Signal på Android:** kontrollerat mot en riktig rapport från en Samsung. Alla sidor öppnas med nyckeln ur rapporten, alla 59 tabeller har samma innehåll som rapportverktygets egen dekrypterade kopia, 47 av 47 meddelanden har samma tider och 7 av 7 bilagor har rätt summa efter dekryptering.
- **Rättat i protokollet:** tabellen EXIF-tagg i filen har sedan 1.26 haft raden `System:FileModifyDate`. Tiden där är när programmet läste filen, inte en tid ur filen. Raden är borta. Läs den inte som filens tid i äldre protokoll.
- **Rättat i Signal-faktorn:** en fil med samma summa som en mottagen bilaga kunde sedan 1.37 få svaret "Skickad i Signal". Det gällde filer som varken var kamerabilder, skärmdumpar eller sparade av Signal. Nu står det "Mottagen i Signal".
- **Signals krypterade filer:** `app_parts/part….mms` och `attachment_files/…` gav "Unknown error" och, på Android, "Inte i Signal". Summan kan aldrig stämma för dem, så nu kopplas de till sitt meddelande med raden i databasen. En rad utan meddelande sägs, eftersom det kan vara en berättelse.
- **Filer som ExifTool inte kan tolka:** filen läses och hashas, och texten säger att innehållet inte gick att tolka, inte att filen inte kunde läsas.
- **Tider ur `metadata.msgpack`:** nanosekunderna avrundas nu till millisekund i stället för att kapas. Det gav falska skillnader på 1 ms mot bildbiblioteket och rapporter.
- **Mindre:** det står "finns inte i rapporten" när källan är en rapport, samma källfil nämns en gång, och modellen står efter rapportens benämning, till exempel "Google Android Generic (SM-A336B)".
- **macOS:** bygget signeras nu ad hoc. Signaturen var ogiltig förut, och det är troligen därför macOS sa att appen var skadad. Apple har inte granskat appen, så macOS varnar ändå vid första start. Hur du öppnar den står under macOS längst ned. Det är inte provat på en Mac med Gatekeeper påslagen.

## Nytt i 1.50

Rapporter i UFDR-format går att läsa, Härkomst kan visa tidslinjen vid flera av filens tidpunkter, och tiderna läses rätt ur extraktioner som har filen `metadata.msgpack`.

- **Välj tidpunkt i Härkomst:** en fil vars tider ligger långt isär, till exempel en gammal bild som nyss kom till telefonen, har knappar ovanför tidslinjen, en per tidpunkt, med tid och antal händelser. En tidslinje visas i taget. Filer med tider nära varandra ser ut som förut. Tidslinjen börjar vid T, om inte materialet saknar allt om telefonen vid T och har något vid en annan tidpunkt. Bedömningen gäller alltid T, och protokollet har alla tidslinjer, oavsett vilken knapp som är vald.
- **Filer utanför biblioteket:** de hade bara en tidslinje, vid tiden i filen. Nu blir filsystemets tid en egen tidpunkt när den ligger långt från den tiden, eftersom en mottagen fil kan behålla avsändarens tid.
- **T står bara på T:** i en tidslinje vid en annan tidpunkt hette mitten T, och kolumnen Vid T visade bedömningens ord från den riktiga T, så att "Saknas" kunde stå bredvid "tänd". Nu har markeringen tidpunktens namn, och kolumnen heter Läget och saknar bedömningens ord. Händelser vid en annan tidpunkt räknas inte längre som "registreringar i fönstret" runt T.
- **Rapport i UFDR-format:** en rapport öppnas som en extraktion, i Härkomst och Queries, med telefonens sökvägar, tiderna ur `report.xml` och nyckelringen om rapporten har den. Rapportverktygets hashsummor kontrolleras mot filerna, och dess tolkningar, som ursprung och justerad plats, står för sig. En rapport är ett urval, så programmet säger att en fil som saknas i rapporten inte behöver saknas på telefonen. Rapporterna har ingen ctime, och programmet säger att den saknas.
- **Provat mot råzippen:** två rapporter från samma telefon som en zipp med 352 747 filer, en med 115 023 och en med 311 807 filer. Storlek, CRC32 och tider skiljer sig inte på någon fil, och 74 queries ger samma rader. I Härkomst ger 37 filer samma T och samma faktorer. Android, skyddade rapporter och raderade rader är inte provade.
- **Tider ur `metadata.msgpack`:** i zippar med den filen håller zippens egna tidsfält bara senaste åtkomst, tre gånger. Programmet tog den för ändringstid, vilket gav fel T för filer utanför biblioteket och falska skillnader i tabellen över filens tider. Nu läses de namngivna tiderna ur `metadata.msgpack`. I två sådana extraktioner har programmet samma tider som en fristående läsning av filen, på alla filer.
- **Plats satt i efterhand:** texten kom på varje bild med attributet `customLocation`, också när platsen var samma som GPS-positionen i filen. I labbet hade 8 av 34 bilder attributet, och sju av dem var vanliga foton. Nu kommer texten bara när filen saknar GPS-position eller när den ligger mer än 50 m från platsen.
- **Okänd filtyp:** en fil av okänd typ fick Inte förenligt i rutan Kamera när en annan app var igång. En sådan fil behöver inte ha tagits med kameran, så nu är det en upplysning.
- **Nyckelringen:** en nyckelring som väljs tillsammans med zippen i Queries följer nu med till ett verktyg som öppnas senare.
- **Positionstexten:** samma tidpunkt kunde stå två gånger ("när filen skickades i WhatsApp och när filen skickades i WhatsApp").

## Nytt i 1.49

Filens tider står öppet i en tabell, och slutsatserna om dem är rättade. Tiderna lästes rätt också förut, men programmet drog för mycket av dem.

- **Tabell över filens tider:** rutan Skapandetid i Härkomst har en tabell med tiden i filen, bibliotekets tider och filsystemets tider. Varje rad har källa och skillnaden mot T, allt står i tidsordning och i samma zon, och det som saknas står kvar. En databaskälla öppnar raden i Queries. Tabellen finns också i protokollet och går att kopiera till Word. Filkortet visar inga tider längre, så att samma tid inte står i två format.
- **AirDrop och dubbletter rättade:** en fil som loggats som mottagen med AirDrop fick "inte förenligt med att filen togs emot med AirDrop", eftersom den lades till långt efter att den skapades. Det är precis så en mottagen fil ser ut. Nu säger en sen tillagd-tid bara emot kamerabilder och skärmdumpar. Samma sak gällde dubbletter i Bilder och sparade filer med en äldre tid.
- **Ändrat datum:** har datumet ändrats i Bilder står det "Tiderna går isär", och att det inte väger mot hypotesen om bibliotekets kopia av originaltiden står kvar. Det är sett på en bild i labbet.
- **Filer utanför biblioteket:** T är då tiden i filen eller filens ändringstid, och den jämfördes med sig själv, så rutan blev alltid grön. Nu jämförs T bara med andra källor, och finns inga säger rutan "Kan inte jämföras". En kopia av en skärmdump kallas inte längre förenlig med kameran.
- **Samma källa räknas inte två gånger:** bibliotekets Skapad är oftast hämtad ur filens egen tid, annars ur filsystemet (`ZDATECREATEDSOURCE`, iOS 15 och senare). Tabellen och texten säger vilket, och att de stämmer visar bara att tiden inte ändrats i biblioteket. Saknar filen egen tid står det att T inte säger när bilden togs.
- **Tidszonen ändrar inte slutsatsen:** en skärmdump utan zon i filen fick "Tiderna går isär" när UTC valdes. Nu tolkas en tid utan zon i bildens egen zon. Saknas den, och skillnaden är jämnt på kvarten, sägs det att det ser ut som en zonskillnad.
- **Video:** en MP4 kallas inte längre EXIF, och QuickTime-tiden står inte längre utan zon.
- **Exif-vyn:** alla tider i filen visas med sin tagg och i UTC, och filsystemets tider står för sig. Två rader som båda hette Skapad heter nu olika saker. För en fil från disk står det att tiderna gäller kopian på datorn.
- **Kontrollerat:** tabellen jämförs med ett fristående facit som läser zippen, EXIF, QuickTime och Photos.sqlite utan programmets kod och utan ExifTool. Det är ett nytt labbtest för varje rad i bildbiblioteket. Inte provat: en vanlig video från Kamera-appen, Android mot det nya facitet och zippar från andra extraktionsverktyg.

## Nytt i 1.48

Från en källa i Härkomst till rätt rad i Queries, listor med filnamn eller hashsummor från disk, och en tydlig skillnad mellan exempel och resultat.

- **Från källa till rad:** ett klick på en källa i Härkomst kör queryn i Queries, markerar raden med händelsen och scrollar dit. Raden ovanför tabellen säger vilken händelse och vilken rad det gäller. På en bild i labbextraktionen gav 301 av 309 länkar en rad och 4 gav två rader med samma tid. I 4 fall kommer sluttiden ur en annan källa, och då markeras raden där det började.
- **Fel databas rättat:** samma query körs mot Signal, WhatsApp, Telegram och Snapchat, och en källa kunde öppna den databas som lästes sist. Nu avgör källans databas och händelsens tid.
- **Lista från disk:** knappen heter **Välj en lista eller bilder…** Den läser en textfil med filnamn eller MD5, SHA-1 eller SHA-256, utdata från md5sum, shasum och hashdeep, eller en CSV-fil med rubrikrad. Bilder letas upp på innehållet som förut.
- **Exempel eller resultat:** innan en query körts är raderna märkta **Exempel**, med texten "Queryn är inte körd". De är färre, kursiva och randiga, och rutan har en egen knapp för att köra queryn. Ett riktigt resultat får märket **Resultat**.
- **Kartan:** **Visa på karta** finns nu också som länk vid resultatet, och knappen säger varför den är avstängd. Punkterna visar radens övriga kolumner. `time_zone_id` togs förut för en tid i Snapchats Memories på Android, och det är rättat.
- **Fart i Queries:** en inläst databas läses inte om när du går tillbaka till den eller öppnar den i en ny flik. Upp till 2 GB hålls kvar, vilket kostar minne. SQL som bara läser körs utan kopia av filen: 0–6 ms mot 140–150 ms på 1,6 GB. Byte till en flik med 2 000 rader tar ca 27 ms mot ca 225 ms.
- **Html-versionen utan JIT, rättelse till 1.47:** i Edge på Windows finns WebAssembly kvar i en tolk när JIT är blockerad. Allt fungerar men tar längre tid, och nu står det högst upp på sidan. Röktestet körs i Edge 156 på Windows med blockerad JIT, förstärkt säkerhet och en policy som bara släpper fram lokala filer. Orsaken till rapporten om att html-versionen slutat fungera är fortfarande inte hittad.

## Nytt i 1.47

Gränsen på 1,5 GB för databaser är borta, och html-versionen säger vad som är fel när webbläsaren stoppar något.

- **Stora databaser:** databaser över 1,5 GB läses i stället för att hoppas över. En påhittad krypterad databas på 5,3 GB gick igenom i appen, Chrome och Edge på en Mac med 32 GB minne: CRC32, SHA-256 och varje byte stämde mot ett facit från Python. Det tar ungefär 1–2 minuter och kräver ungefär dubbelt så mycket ledigt minne som databasen är stor.
- **När minnet tar slut:** appen säger hur stor filen är och vad som kan hjälpa, och fortsätter att köra.
- **Electron 45:** skrivbordsappen går över till Electron 45, eftersom Electron 44 inte klarar en enskild databas över 2 GB.
- **Html-versionen utan WebAssembly:** om webbläsaren har stängt av WebAssembly, till exempel för att JIT är blockerad i Edge, står det nu högst upp på sidan och i verktygen som drabbas. Förut syntes bara ett fel i konsolen, och EXIF & karta stod kvar på "Startar ExifTool…".
- **Kartan utan WebGL2:** beskedet är begripligt och på svenska. Resten av verktyget fungerar som förut.
- **Html-versionen i övrigt:** versionsnumret står nu med i protokollet från Härkomst, konsolen är fri från blockerade anrop och `LÄS MIG.txt` har ett avsnitt om vad som kan stoppa programmet i en låst webbläsare.
- **WebKit:** ExifTool kunde inte läsa filer under `file://`, och det är rättat. Riktiga Safari är inte provat.
- **Kontroller:** det nya `npm run test:html` kör html-versionen under `file://` utan internet. I CI körs det i Edge på Windows, också med en policy som bara släpper fram lokala filer. Orsaken till rapporten om att html-versionen slutat fungera är inte bekräftad, och det här är första gången den körs på Windows.

## Nytt i 1.46

Sökningar i stora extraktioner går betydligt snabbare. Resultaten är desamma: de befintliga kontrollerna mot labbtelefonen går igenom, och dekrypteringen är jämförd byte för byte med den gamla vägen.

- **Telegram:** avkodningen tog orimligt lång tid med många meddelanden, eftersom en lista kopierades för varje meddelande. 150 000 meddelanden med bilder tar nu ungefär 2 s i stället för 33 s. Samma fel är rättat för `-wal`-filer med många transaktioner.
- **Sökningar i zippen:** namnen i innehållsförteckningen läses in en gång i stället för vid varje sökning. En sökning tar 25–80 ms i stället för 300–400 ms, och en filnamnssökning gör 3–10 sådana. Det kostar ungefär 100 MB mer minne i en extraktion med 630 000 poster.
- **Signal:** databasen dekrypteras med webbläsarens inbyggda krypto, också i Queries. 512 MB tar 1,4 s i stället för 17 s. HMAC kontrolleras för varje sida som förut. Utan WebCrypto används den gamla vägen.
- **Appen fryser inte under dekrypteringen**, och statusraden visar hur långt den kommit.

## Nytt i 1.45

Härkomst är jämförd med en labbsession på en iPhone där varje steg loggades med tid, och det som inte stämde är rättat.

- **Fel typ:** en bild ur Safari och en dubblett i Bilder kallades Skärmdump, eftersom `ZIMPORTEDBY` 8 räknades som skärmdump. Nu krävs SpringBoard som skaparapp eller `ZKINDSUBTYPE` 10.
- **AirDrop** känns igen på `ZIMPORTEDBY` 13, också när en dubblett skrivit om skaparappen på originalet. Dubbletter har en egen typ. Varken kameran eller appen frågas för dem.
- **WhatsApp:** en mottagen bild som sparats kallades "vald ur bildbiblioteket". Nu står det "sparad i bildbiblioteket". Typ 38 visas som engångsvisning. Kameran frågas inte för en fil som tagits emot i en chatt.
- **WhatsApp med låst telefon:** ett meddelande som tas emot i bakgrunden hamnar inte i `ChatStorage.sqlite` förrän appen öppnas. Härkomst läser tilläggets logg och visar det som mottaget men inte i databasen.
- **Signal:** Härkomst och Queries visar om ett meddelande skickades från en länkad enhet, när ett mottaget meddelande med försvinnande tid öppnades, om en engångsbild har visats och vilka berättelser som lagts upp. Ett meddelande från en länkad enhet räknas inte som att telefonen användes.
- **Bildbiblioteket:** Raderade och redigering visas med tid. En plats satt i Bilder märks och väger inte i positionsbedömningen, och en position som bara finns i databasen sägs vara det. Flaggorna står på svenska.
- **Filsystemets tider:** HEIC-filen skrivs färdig efter att bilden tagits (9–50 s i labbet, med och utan Live Photo). AirDrop och dubbletter behåller källans skapandetid, och det sägs nu i texten. Tiderna visar zonen när en annan dag än bildens visas i bildens fasta förskjutning.
- **Osända kamerabilder:** en bild i WhatsApps eller Telegrams `tmp/` får appen som källa och säger om något meddelande skickades strax efter.
- **Möjlig koppling:** en kamerabild som också valts ur biblioteket behåller den möjliga kopplingen till kamerameddelandet.
- **Skärmen:** tänd skärm med låst telefon får en upplysning om att aviseringar tänder skärmen.
- **Kontroller:** ett nytt facit ur labbsessionen körs i `npm run test:app`.

## Nytt i 1.44

Filsystemets tider i zippen tolkas rätt, och det syns tydligare var en tid kommer ifrån.

- **Skapandetiden i filsystemet var fel tid i vissa zippar.** I zippar med fyra tider i UT-fältet visades den tredje som skapandetid. Den ser ut att vara inodens ändringstid (ctime), och den fjärde den riktiga skapandetiden. Filer kunde därför få texten att de kommit till i filsystemet senare än de skapades, som vid kopiering, fast det bara var metadatan som ändrats. Tolkningen är härledd ur en iOS-labbextraktion, inte dokumenterad av extraktionsverktyget.
- **ctime visas för sig**, som "Metadata ändrad (ctime)", utan slutsats.
- **Zippar med tre tider:** den tredje heter "Tredje tiden i zippen (skapad eller ctime)", eftersom zippen inte säger vilken det är. Den används inte som skapandetid.
- **Kortet i Härkomst** är uppdelat i filen i extraktionen, filsystemets tider och EXIF, så att tiderna inte tas för EXIF.
- **Nya formuleringar:** "enligt zippen" är borta i Härkomst och Queries. "Filen kom till biblioteket när den skapades" är ersatt med hur långt efter Skapad filen lades till. Fältnamnet (UT-fältet, NTFS-fältet) står i protokollet.
- **Sammanfattningen av Skapandetid** säger "inom en minut" bara när Tillagd ligger så nära Skapad.

## Nytt i 1.43

PowerLog på iOS: skärmen, låset och kameran per app i Härkomst och Queries.

- **Skärmen och låset på iOS 26.** knowledgeC registrerar inte längre skärmen på iOS 26, och Biome inte heller. Härkomst läser därför skärmen och låset ur PowerLog (`CurrentPowerlog.PLSQL` och dagsarkiven). Finns både knowledgeC och PowerLog, står båda källorna i faktorn, och säger de olika står det så.
- **Kameran per app.** PowerLog registrerar när en app startar och stänger kameran, också WhatsApps, Telegrams och Signals egna kameror. Kamerafaktorn kan därför avgöra om appen som sparade bilden använde kameran när bilden togs. Förut bedömdes bara om appen var igång.
- **Appen på skärmen** ur PowerLog, när knowledgeC saknar app-aktivitet i fönstret.
- **Rättad tid.** PowerLog skriver med en egen tid, som rättas med PowerLogs tabell för tidsförskjutning. Kontrollerat mot knowledgeC, där tiderna stämmer på ungefär en sekund. Utan tabellen används inte raderna, eftersom felet kan vara allt från sekunder till år.
- **Dagsarkiven** (`Archives/powerlog_….PLSQL.gz`) packas upp i minnet för dagarna kring fönstret. Ibland är den aktuella filen tom, och då finns allt i arkiven.
- **Glapp:** när telefonen var avstängd har PowerLog ett glapp. Där gäller inget läge, och faktorerna säger det.
- **Queries:** PowerLog under App-aktivitet, med kameran per app, skärmen, låset, appen på skärmen och tidsförskjutningen. Tiderna är rättade. Ett dagsarkiv (`.PLSQL.gz`) kan öppnas direkt och packas upp i minnet.

## Nytt i 1.42

Telegram på iOS i Härkomst och Queries (beta), och skydd mot formler i CSV-filerna.

- **Telegram på iOS.** Telegram sparar meddelandena i ett eget format. Härkomst och Queries avkodar det i minnet. Filen ändras inte, och spårbarheten och protokollet säger att tabellerna är avkodade.
- **Filen mot Telegram.** Härkomst kopplar filen till Telegram på tre sätt:
  - Telegrams egna filer under `postbox/media/` hör till sitt meddelande.
  - En bild som valts ur bildbiblioteket finns i Telegrams lagringsdatabas, med bibliotekets id och den uppladdade bildens storlek.
  - En bild som Telegram sparat får en möjlig koppling till meddelandet strax efter.

  En bild med originalnamnet `camphoto_…` som finns kvar i Telegrams `tmp/` togs med Telegrams kamera.
- **Queries:** nya queries för Telegrams meddelanden, bilder och videor, samtal, kontakter och chattar, och för lagringsdatabasens bilder valda ur bildbiblioteket. En kontrollquery läser meddelandenas tid och id ur nycklarna med vanlig SQL.
- **Tidslinjen** har rader för WhatsApp och Telegram.
- **CSV:** en cell som börjar med =, +, -, @, tabb eller vagnretur får en apostrof först, så att Excel inte tolkar den som en formel. Det gäller Queries, EXIF & karta, Positioner och App-id. Vanliga tal lämnas som de är.
- **Appversionen** för Telegram står i protokollet.
- **Rättat:** skärmraden sa att skärmen var tänd enligt WhatsApps eller Telegrams "logg". Källan är appens databas, och nu står det så.

## Nytt i 1.41

Signal och WhatsApp på iOS i Härkomst och Queries (beta).

- **Signal på iOS.** Signals databas på iOS är krypterad, med nyckeln i telefonens nyckelring. Välj nyckelringen (`…_keychain.plist` bredvid zippen) tillsammans med zippen i raden högst upp, eller med **Nyckelfil…**. Databasen dekrypteras i minnet; zippen och nyckelringen ändras inte.
- **Filen mot Signals bilagor.** Härkomst jämför filens SHA-256 och namn med varje bilaga och visar meddelanden och samtal i tidslinjen. Signal kodar om bilder, så en bild ur bildbiblioteket som skickats har inte bilagans summa: då står det att ingen koppling hittades, inte att filen saknas i Signal.
- **WhatsApp på iOS.** Härkomst kopplar filen till WhatsApp på SHA-256, på posten i bildbiblioteket (WhatsApp sparar bibliotekets id för en bild som valts därifrån) och på WhatsApps egen fil under `Message/`. En sådan fil prövas som mottagen eller skickad i WhatsApp, och kameran frågas inte. En bild som WhatsApp sparat efter att den tagits med WhatsApps kamera får en möjlig koppling till meddelandet strax efter; där binder bara tiden.
- **Queries:** nya kataloger för Signal (meddelanden, bilagor, en bilaga efter SHA-256, samtal, konversationer, kontakter) och WhatsApp (meddelanden, mediefiler, en mediefil efter SHA-256, filer valda ur bildbiblioteket, chattar, visningsnamn).
- **Hashsökningen** i Härkomst hittar också summor bland Signals och WhatsApps filer på iOS.
- **Appversionen** för Signal och WhatsApp står i protokollet, ur appens Info.plist.
- **Provkörningar:** röktestet har en krypterad Signal-databas, en påhittad nyckelring och WhatsApp, och kontrollerna mot en iOS-labbtelefon jämför Härkomsts kopplingar med källorna i extraktionen.

## Nytt i 1.40

En genomgång av 1.34–1.39, med rättningar och fasta provkörningar.

- **Rättat: Signal-fönster utan loggar.** Skickades eller valdes filen i Signal långt efter att den skapades fick fönstret kring sändningen bara Signals egna rader. Nu har det skärm, lås, appen i förgrunden och kameran, som de andra fönstren.
- **Rättat: nycklarna till Signal.** En inklistrad nyckel av det ena slaget (databas eller bilagor) dolde den andra nyckeln i extraktionens nyckelfil. Nu tas varje nyckel för sig.
- **Rättat: fil från disk med samma namn i flera mappar.** En bild från disk som finns i DCIM bedöms direkt på raden i rätt mapp, utan vallista.
- **Rättat: iOS-versionen i raden högst upp** saknades när extraktionen öppnades i Queries.
- **Rättat: två extraktioner tätt efter varandra i Härkomst** kunde blandas. Nu öppnas de i tur och ordning.
- **En trasig `-wal` stoppar inte längre.** Har `-wal` fel checksumma i huvudet eller fel sidstorlek läses databasen utan den, som SQLite gör, och en varning säger det i Härkomst, i protokollet och i Queries.
- **Appversionen i protokollet.** Protokollet säger vilken version av Snapchat och Signal uppgifterna kommer från och var versionen står: appens Info.plist på iOS, och `packages.xml`, Snapchats Memories eller Signals logg på Android.
- **Kartan utan WebGL2**, till exempel i en virtuell maskin utan grafikkort, säger det på svenska i stället för att stanna med ett fel.
- **`/app/inFocus`:** texterna säger nu samma sak överallt: strömmen saknas på iOS 18 och 26, de versioner som kontrollerats.
- **Fasta provkörningar.** Appen provkörs i Electron mot påhittade data, och Härkomsts tider jämförs med facit från en labbtelefon.

## Nytt i 1.39

- **En knapp för extraktion och databas i Queries.** Knappen högst upp heter **Öppna extraktion eller databas…** och tar emot en extraktion (zip) eller en databas med sin `-wal`. Queries känner igen vad du valde: en zip öppnas som extraktion, och en databas känns igen på sina tabeller och öppnas med sina queries, Photos.sqlite med rätt iOS-version. Knappen **Välj databas och -wal…** är borttagen.
- **Databasen från disk** står i källraden med **Stäng filen**, och spårbarheten visar filens namn, storlek, ändringstid och SHA-256. En `-wal` som väljs ensam läggs till databasen. Passar inte alla queries, eller ingen, står det i källraden. Med en extraktion öppen går filen före zippen för sin databas tills den stängs.
- **Listan till vänster går att fälla ihop.** Ett klick på en databas fäller ut eller ihop dess queries, också den som är vald, och en query öppnas med ett klick på den.
- **Öppnar du extraktionen medan en query visas** används databasen ur zippen direkt, med samma query.
- **Rättat:** efter en körning utan rader stod de påhittade exempelraderna kvar. Nu står det att queryn inte gav några rader.

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
- **ForensicsToolbox-*.dmg** / **.zip** — signerat ad hoc, inte granskat av Apple. macOS varnar vid första start. Försök öppna appen, och välj sedan **Öppna ändå** under Systeminställningar > Integritet och säkerhet.

Kartdata © OpenStreetMap-bidragsgivare (ODbL), via Protomaps.
