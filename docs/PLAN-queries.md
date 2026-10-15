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
