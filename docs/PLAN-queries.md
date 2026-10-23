# Plan: tydligare Queries-vy

Mål: användaren ska direkt se vad en query gör, stegen ska vara tydliga, och den mest
användbara queryn ska vara förvald. Ingen commit eller push utan att användaren ber om det.

## Klart

- **Kataloger:** varje query i Android, App-aktivitet och Photos.sqlite säger i en mening
  vad den gör (`description` på Android, annars `subtitle`). Varje databas har exakt en
  `recommended`. Hjälpfrågor heter "Hjälp: …" eller "Tips: …" och har `group: "advanced"`.
  `catalogs.test.js` kontrollerar detta. Kör `npm run sync-queries` efter ändringar.
- **Vyn** (`tools/db-queries/`): den rekommenderade queryn är förvald och har ★ i listan.
  Rutan "2. Query" visar titel, märke och "Vad den gör: …". Stegen är en numrerad lista.
  Vänster kolumn har databasinfo, steg, query och sökvärden. Höger kolumn har SQL överst
  och "Så kan resultatet se ut" under.
- **SQL-färger** för mörkt och ljust tema (`colorSql` i `script.js`, `--sql-*` i `style.css`).
- **Förhandsvisning** (`preview.js`): kolumnerna läses ur SQL:en och exempelvärdena väljs
  efter kolumnnamn och plattform (iOS-filnamn, `DCIM/100APPLE`, tidszon, personer, album,
  strömmar, flaggor). Text i `CASE … THEN '…'` används som värde. Schemafrågor visar
  tabell- och kolumnnamn. Sluttider ligger `usage_seconds` efter starttiden.
  `preview.test.js` kräver att ingen kolumn i någon katalog saknar exempelvärde.
- **Förstasidan:** två kolumner, iOS och Android. Varje kort visar namn, beskrivning,
  sökväg, antal queries och den rekommenderade queryn. Photos.sqlite har knappar per
  iOS-version. Rullgardinen visas först när en databas är vald, med "← Alla databaser".
- Layouten är kontrollerad med skärmdumpar i båda temana (förstasidan, MediaStore,
  Photos.sqlite och knowledgeC).

## Kvar (valfritt)

1. Visa kolumnerna queryn returnerar under beskrivningen (t.ex. "Visar: sökväg, MIME,
   tider, ägar-app"). Lägg i så fall till ett fält `returns` i katalogen hellre än att
   tolka SQL:en.
2. `columns-asset` i Photos.sqlite har två `PRAGMA`; förhandsvisningen visar bara den första.

---

# Plan 1.24: buggfixar, routined och queries som körs i appen

**Status:** allt nedan är byggt och testat (`npm test`, och körning i Electron mot en
påhittad Cache.sqlite med rader som bara finns i `-wal`). Inte committat.

Beslut: `ZTYPE` i `ZRTCLLOCATIONMO` tar bara med kända värden, 1 (GNSS) och 4 (Wi-Fi).
`-wal` ska alltid läsas med när en query körs i appen.

## Del A: buggar

1. **Tidsstämplar** (`electron/media-protocol.js`): ingen `utimes()`. `O_NOATIME` där det finns,
   annars en rad i EXIF-visaren om att åtkomsttiden kan ändras. Inget fel på skrivskyddade diskar.
2. **Iframes** (`electron/main.js`, `preload.js`): läsbryggan bara i `file://`-ramar,
   `media-allow` kontrollerar avsändarramen, `will-frame-navigate` stoppar http(s) i iframes.
   Ingen CSP ännu.
3. **Kartlager** (`map-view.js`): en enda väntande `style.load`, inga dubbla lager.
4. **Tidszon**: tider utan zon visas som "antagen zon", inte UTC.
5. **Release-bygget**: `concurrency`, och en publicerad release görs inte om till utkast.
6. **Småfel**: stora bilder (> 80 MB) via blob, `%`-fel ger 404, kartan kan startas om.
7. **`postMessage`**: kontrollera `event.source`.
8. **Städning**: ta bort gamla `script.js`/`style.css` i `android-queries`, `app-usage-queries`,
   `photos-sqlite-queries` (bara omdirigering kvar). Uppdatera `docs/DEVELOPMENT.md`.

## Del B: Queries

1. **routined `Cache.sqlite`**: ny katalog `queries/ios/routined/`. Queries: positioner i
   tidsspann (rekommenderad, sökvärden för tid och noggrannhet, `ZTYPE IN (1, 4)`), besök
   (`ZRTVISITMO`, pågående besök hanteras). Filtret på råvärdet, inte på `localtime`-text.
2. **Kör i appen**: välj databasen och dess `-wal`. WAL-ramarna fram till sista giltiga commit
   läggs på databasen i minnet (salt och checksumma kontrolleras), sedan sql.js. Visar antal
   ramar som lades på. Källfilerna läses bara. Resultat som tabell och CSV.
3. **Visa på karta**: resultat med latitud/longitud skickas till Positioner som egen källa,
   med noggrannhet som cirkel.
4. **CSV-import**: citattecken, tidskolumner `*_utc`/`*date*`, `uncertainty` som noggrannhet,
   kolumnnamn som slutar på `utc` ger zonen UTC.
5. **Besök på kartan**: område med in- och uttid och varaktighet.
6. **Rester från förra planen**: fältet `returns` och båda `PRAGMA` i `columns-asset`.

Ingen commit eller push utan att användaren ber om det.

## Efter 1.24

- **Tider som datum i SQL:en** (byggt): tidsspannet står som
  `CAST(strftime('%s', '2026-03-04 00:00:00+01:00') AS INTEGER)`, minus 978307200 för Cocoa-tid,
  gånger 1000 för millisekunder. Datum utan klockslag tar med hela dagen. Provkört mot
  iOS 18.7.7 (FFS) och Pixel 9 (full fil) i K123456-26: alla queries går igenom.
- **MediaStore** (byggt): kolumnen heter `datetaken`, inte `date_taken`.
- **Peka på en extraktion:** egen plan i [PLAN-extraktion.md](PLAN-extraktion.md).
