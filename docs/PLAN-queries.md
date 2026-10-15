# Plan: tydligare Queries-vy

Mål: användaren ska direkt se vad en query gör, stegen ska vara tydliga, och den mest
användbara queryn ska vara förvald. Ingen commit eller push utan att användaren ber om det.

## Klart (okommitterat på main)

- `queries/android/catalog.json`: varje query har `description` (vad den gör, på svenska).
  En query per kategori har `recommended: true` och ligger först. Schema-frågorna heter
  "Hjälp: …" och har `group: "advanced"`. ALEAPP-tipsen heter "Tips: …" och är också
  `advanced`. `catalog.js` är regenererad med `npm run sync-queries`.
- `tools/db-queries/script.js`:
  - `recommendedQuery` väljer `recommended`, annars första som inte är `advanced`.
  - Android-queries använder `description` som `subtitle` (tidigare `goal`, t.ex. "probe").
  - Rutan ovanför SQL:en visar alltid den valda queryn: titel, märke
    (Rekommenderas eller Hjälp) och "Vad den gör: …". Den uppdateras när man byter query.
  - Flödet heter "Så här gör du" och är en numrerad lista (`.flow-steps`).
  - Knappen heter "Välj en annan query…" och "Använd rekommenderad query".
  - Rekommenderad query får ★ i listan.
- `tools/db-queries/style.css`: större stegrubriker (15 px), numrerade stegcirklar, större
  beskrivningstext (14 px), knappen ser ut som en riktig knapp.

- Stegtexten radbryts inte längre vid `<code>` (texten ligger i en `<span>`).
- **Förhandsvisning:** `tools/db-queries/preview.js` (`QueryPreview.columns`,
  `exampleRows`) läser kolumnerna ur SQL:en och hittar på tre exempelrader efter
  kolumnnamnet. Inmatat filnamn och paket används i exemplen. Vyn visar SQL till vänster
  och "Så kan resultatet se ut" till höger (en kolumn under 1100 px). Test i
  `preview.test.js`.

- Layout: vänster kolumn har databasinfo, steg, val av query och sökvärden. Höger kolumn
  har SQL överst (rubrik, färgförklaring och knappar på en rad) och förhandsvisningen under.
- SQL-färger: nyckelord, funktioner, strängar, tal och kommentarer har egna färger
  (`--sql-kw`, `--sql-fn`, `--sql-str`, `--sql-num`, `--sql-comment`) för mörkt och ljust tema.
  Tokeniseringen finns i `colorSql` i `script.js`.

## Kvar att göra

A. **Kontrollera layouten i webbläsaren** i båda temana: att SQL-rutan inte är för hög,
   att knapparna i `.sql-head` inte blir 100 % breda, och att förhandsvisningen syns utan
   att man måste scrolla långt. Justera `grid-template-columns` i `.workspace` (vänster
   360–520 px) och `max-height` i `style.css` vid behov.
B. **Snygga till förstasidan** (ingen databas vald, `renderOverview` i `script.js`,
   `.db-overview`/`.db-grid`/`.db-card` i `style.css`). Förslag: två tydliga sektioner,
   iOS och Android, med kort per databas. Varje kort visar namn, en mening om vad den
   innehåller, sökvägen i liten monospace och märket med den rekommenderade queryn.
   Hela kortet är klickbart, har hover-effekt och fungerar i båda temana. Ta bort
   dubbel text mellan kortet och rullgardinen.

0. Kontrollera förhandsvisningen för Photos.sqlite och knowledgeC: kolumner med
   Z-prefix (ZFILENAME, ZDATECREATED) och Cocoa-tider ska få rimliga exempelvärden.
   Lägg till regler i `RULES` i `preview.js` vid behov, med test.

1. **Kontrollera i webbläsaren** (`python3 -m http.server` i repots rot, öppna
   `tools/db-queries/queries.html`): Android MediaStore, App-användning, Kameraaktivitet,
   Photos.sqlite och knowledgeC. Både ljust och mörkt tema. Kolla att ★-märkningen,
   Hjälp-märket och beskrivningen syns, och att stegcirklarna inte krockar med `<code>`.
2. **Samma tydlighet för iOS och app-usage.** Gå igenom `queries/app-usage/catalog.json`
   och `queries/ios/photos-sqlite/catalog.json`. Varje query ska ha en `subtitle` som säger
   vad den gör i en mening (inte bara upprepar titeln). Exakt en `recommended` per databas.
   Mappa `group` även för app-usage i `buildDatabases` om den har sådana. Kör
   `npm run sync-queries` efter ändringar.
3. **Test** i `tools/db-queries/photos-catalog.test.js` (eller ny `android-catalog.test.js`
   som läggs till i `scripts/run-tests.js`): varje Android-kategori har exakt en
   `recommended`, den är inte `advanced`, och varje query har en icke-tom `description`.
4. **Valfritt:** visa kolumnerna queryn returnerar (t.ex. "Visar: sökväg, MIME, tider,
   ägar-app") under beskrivningen. Lägg i så fall till ett fält `returns` i katalogen hellre
   än att tolka SQL:en.
5. Kör `npm test`. Höj sedan versionen i `Toolbox.html` och lägg en rad i
   `.github/release-notes.md` om användaren vill ha en release.
