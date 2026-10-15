Automatiskt byggd från commit `{{SHA}}`.

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
