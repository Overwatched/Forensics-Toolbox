Automatiskt byggd från commit `{{SHA}}`.

## Nytt i 1.7
- **Karta i EXIF-visaren** — alla filer med position på en karta. Klustrade punkter, klick för miniatyrbild och metadata, rutt i tidsordning (UTC-tider och lokala tider jämförs som verklig tidpunkt) och export till KML (Google Earth) och GeoJSON (QGIS).
- **Offlinekarta inbyggd** — hela världen i översikt och Sverige i gatunivå (gator, gångvägar, byggnader) från OpenStreetMap. Inget lämnar datorn.
- **Onlinekarta vid behov** — OpenFreeMap kan slås på för en mer detaljerad karta i hela världen. Tjänsten ser bara vilka kartrutor som hämtas, inga filer eller metadata. Appen skickar ingen Referer, inga cookies och inget appnamn.
- **Tidsfilter** — från–till för tabell, karta och export.
- **Portabel Windows-version som zip** — packa upp och kör `Forensics Toolbox.exe`. Startar direkt; den gamla portabla exe:n packade upp hela appen vid varje start.

## Windows
- **ForensicsToolbox-{{VERSION}}-Installer.exe** — installer
- **ForensicsToolbox-{{VERSION}}-Portable.zip** — portabel, packa upp och kör `Forensics Toolbox.exe`

## HTML-mapp (ingen .exe)
- **ForensicsToolbox-{{VERSION}}-html.zip** — packa upp och öppna `Toolbox.html` i webbläsaren (för miljöer där körbara filer inte är tillåtna). Offlinekartan ingår inte; kartfilerna finns under releasen [{{MAPS}}](https://github.com/Overwatched/Forensics-Toolbox/releases/tag/{{MAPS}}).

## Linux
- **ForensicsToolbox-*.AppImage** — körbar AppImage (x64)

## macOS
- **ForensicsToolbox-*.dmg** / **.zip** — osignerat bygge (Gatekeeper kan varna; högerklicka → Öppna)

> macOS-binären är **inte** notariserad/signerad i CI. Windows är osignerad också.

Kartdata © OpenStreetMap-bidragsgivare (ODbL), via Protomaps.
