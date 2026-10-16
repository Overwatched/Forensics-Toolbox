Automatiskt byggd från commit `{{SHA}}`.

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
