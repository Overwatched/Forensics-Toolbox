/* Genererad från notes/catalog.json — används när fetch() blockeras (file://). */
window.NOTES_CATALOG = {
  "id": "notes",
  "title": "Anteckningar",
  "sourceNote": "Telefonens anteckningsappar. Apples Anteckningar lagrar texten gzip-packad i ett eget protobufformat; den avkodas i minnet till tabellerna anteckning och anteckningsmapp, och databasen ändras inte. Samsung Notes har texten som vanlig text i sdoc.db.",
  "paramLabels": {},
  "databases": [
    {
      "id": "apple-notes",
      "os": "iOS",
      "label": "NoteStore.sqlite (Anteckningar)",
      "derive": "apple-notes",
      "blurb": "Apples Anteckningar: titel, mapp, konto, skapad och ändrad, låst, raderad (Nyligen raderade) och fäst, med texten avkodad, checklistor (☐/☑), länkar och bilagornas typer.",
      "dbPathHint": "/private/var/mobile/Containers/Shared/AppGroup/<GUID>/NoteStore.sqlite (+ -wal), i appgruppen group.com.apple.notes",
      "paths": [
        "NoteStore.sqlite"
      ],
      "source": "Kontrollerad mot en labbtelefon (iOS 26.4.1, 2026-11-19) med en anteckning i iCloud. ZICNOTEDATA.ZDATA är gzip med NoteStoreProto: 2 dokument → 3 anteckning → 2 texten och 5 formateringen (1 längd, 2 styckeformat med 5 checklista, 9 länk, 12 bilaga). Kolumnernas namn skiftar mellan iOS-versionerna och väljs efter schemat: titeln ZTITLE1, skapad ZCREATIONDATE3 (äldre ZCREATIONDATE1), ändrad ZMODIFICATIONDATE1, mappen ZFOLDER med ZTITLE2 och ZFOLDERTYPE 1 för Nyligen raderade, kontot genom mappens ZOWNER. En låst anteckning (ZISPASSWORDPROTECTED) är krypterad: titeln och tiderna syns, inte texten. Låsta, raderade, checklistor och bilagor är inte kontrollerade i ett labb.",
      "queries": [
        {
          "id": "notes-all",
          "title": "Alla anteckningar",
          "recommended": true,
          "subtitle": "En rad per anteckning, den senast ändrade först: titeln, mappen, kontot, tiderna, om den är låst, raderad eller fäst, och texten.",
          "returns": "titel, mapp, konto, skapad, ändrad, låst, raderad, fäst, tecken, bilagor, text",
          "sql": "-- Tabellen anteckning är avkodad i minnet ur ZICCLOUDSYNCINGOBJECT och ZICNOTEDATA. kalla säger vilka rader.\nSELECT titel, mapp, konto, skapad_utc, andrad_utc, last, raderad, fast, tecken, bilagor, text, kalla\nFROM anteckning\nORDER BY andrad_ms DESC;"
        },
        {
          "id": "notes-deleted",
          "title": "Raderade anteckningar",
          "subtitle": "Anteckningar i Nyligen raderade eller markerade för radering. De ligger kvar i 30 dagar innan appen tar bort dem.",
          "returns": "titel, mapp, hur raderad, skapad, ändrad, text",
          "sql": "SELECT titel, mapp, hur_raderad, skapad_utc, andrad_utc, text, kalla\nFROM anteckning\nWHERE raderad = 1\nORDER BY andrad_ms DESC;"
        },
        {
          "id": "notes-locked",
          "title": "Låsta anteckningar",
          "subtitle": "Anteckningar med lösenord: titeln, mappen, tiderna och lösenordstipset syns, texten är krypterad.",
          "returns": "titel, mapp, konto, skapad, ändrad, lösenordstips",
          "sql": "SELECT titel, mapp, konto, skapad_utc, andrad_utc, losenordstips, kalla\nFROM anteckning\nWHERE last = 1\nORDER BY andrad_ms DESC;"
        },
        {
          "id": "notes-folders",
          "title": "Mappar och konton",
          "subtitle": "Mapparna med konto, slag (Nyligen raderade, smart mapp) och antalet anteckningar.",
          "returns": "namn, slag, konto, anteckningar, raderad",
          "sql": "SELECT namn, slag, konto, anteckningar, raderad, identifierare\nFROM anteckningsmapp\nORDER BY konto, namn;"
        },
        {
          "id": "notes-extras",
          "title": "Checklistor, länkar och bilagor",
          "subtitle": "Anteckningar med checklistor, länkar eller bilagor, med bilagornas typer (UTI).",
          "returns": "titel, checklista, länkar, bilagor, bilagornas typer, ändrad",
          "sql": "SELECT titel, checklista, lankar, bilagor, bilagetyper, andrad_utc, kalla\nFROM anteckning\nWHERE checklista > 0 OR lankar IS NOT NULL OR bilagor > 0\nORDER BY andrad_ms DESC;"
        },
        {
          "id": "notes-raw",
          "title": "Hjälp: texten som den ligger i databasen",
          "group": "advanced",
          "subtitle": "ZICNOTEDATA: anteckningens rad och storleken på den packade texten. Den avkodade texten står i tabellen anteckning.",
          "returns": "rad, anteckning, byte, gzip",
          "sql": "SELECT Z_PK AS rad, ZNOTE AS anteckning, length(ZDATA) AS byte, CASE WHEN hex(substr(ZDATA, 1, 2)) = '1F8B' THEN 1 ELSE 0 END AS gzip\nFROM ZICNOTEDATA\nORDER BY Z_PK;"
        }
      ]
    },
    {
      "id": "samsung-notes",
      "os": "Android",
      "label": "sdoc.db (Samsung Notes)",
      "blurb": "Samsung Notes: titel, mapp, skapad och ändrad, låst, favorit och papperskorgen, med texten. Hela anteckningen med bilder och handskrift ligger i en .sdocx-fil (en zip) som raden pekar på.",
      "dbPathHint": "/data/data/com.samsung.android.app.notes/databases/sdoc.db (+ -wal); filerna i SDocData/",
      "paths": [
        "data/data/com.samsung.android.app.notes/databases/sdoc.db"
      ],
      "source": "Kontrollerad mot Samsung A33 (Android 16, 2026-11-11) med två anteckningar. content är texten som UTF-8, createdAt och lastModifiedAt millisekunder i UTC, categoryUUID mappen i category_tree (trash:/// är papperskorgen), recycle_bin_time_moved när den flyttades dit. En tom title visas som första raden, som i appen. Låsta och raderade anteckningar är inte kontrollerade i ett labb.",
      "queries": [
        {
          "id": "notes-all",
          "title": "Alla anteckningar",
          "recommended": true,
          "subtitle": "En rad per anteckning, den senast ändrade först: titeln, mappen, tiderna, om den är låst, i papperskorgen eller favorit, och texten.",
          "returns": "id, titel, mapp, skapad, ändrad, låst, raderad, till papperskorgen, favorit, text, fil, identifierare",
          "sql": "SELECT\n  s._id AS id,\n  CASE WHEN s.title <> '' THEN s.title ELSE substr(CAST(s.content AS TEXT), 1, 80) END AS titel,\n  (SELECT replace(c.displayName, char(8203), '') FROM category_tree c WHERE c.UUID = s.categoryUUID) AS mapp,\n  datetime(s.createdAt / 1000, 'unixepoch') AS skapad_utc,\n  datetime(s.lastModifiedAt / 1000, 'unixepoch') AS andrad_utc,\n  s.isLock AS last,\n  CASE WHEN s.isDeleted = 1 OR s.categoryUUID LIKE 'trash:%' OR s.recycle_bin_time_moved > 0 THEN 1 ELSE 0 END AS raderad,\n  CASE WHEN s.recycle_bin_time_moved > 0 THEN datetime(s.recycle_bin_time_moved / 1000, 'unixepoch') END AS till_papperskorgen_utc,\n  s.isFavorite AS favorit,\n  CASE WHEN s.isLock = 1 THEN NULL ELSE CAST(s.content AS TEXT) END AS text,\n  s.filePath AS fil,\n  s.UUID AS identifierare\nFROM sdoc s\nORDER BY s.lastModifiedAt DESC;"
        },
        {
          "id": "notes-deleted",
          "title": "Raderade anteckningar",
          "subtitle": "Anteckningar i papperskorgen eller markerade som raderade, med när de flyttades dit.",
          "returns": "id, titel, mapp, skapad, ändrad, låst, raderad, till papperskorgen, favorit, text, fil, identifierare",
          "sql": "SELECT\n  s._id AS id,\n  CASE WHEN s.title <> '' THEN s.title ELSE substr(CAST(s.content AS TEXT), 1, 80) END AS titel,\n  (SELECT replace(c.displayName, char(8203), '') FROM category_tree c WHERE c.UUID = s.categoryUUID) AS mapp,\n  datetime(s.createdAt / 1000, 'unixepoch') AS skapad_utc,\n  datetime(s.lastModifiedAt / 1000, 'unixepoch') AS andrad_utc,\n  s.isLock AS last,\n  CASE WHEN s.isDeleted = 1 OR s.categoryUUID LIKE 'trash:%' OR s.recycle_bin_time_moved > 0 THEN 1 ELSE 0 END AS raderad,\n  CASE WHEN s.recycle_bin_time_moved > 0 THEN datetime(s.recycle_bin_time_moved / 1000, 'unixepoch') END AS till_papperskorgen_utc,\n  s.isFavorite AS favorit,\n  CASE WHEN s.isLock = 1 THEN NULL ELSE CAST(s.content AS TEXT) END AS text,\n  s.filePath AS fil,\n  s.UUID AS identifierare\nFROM sdoc s\nWHERE s.isDeleted = 1 OR s.categoryUUID LIKE 'trash:%' OR s.recycle_bin_time_moved > 0\nORDER BY s.recycle_bin_time_moved DESC;"
        },
        {
          "id": "notes-locked",
          "title": "Låsta anteckningar",
          "subtitle": "Anteckningar med lås. Texten visas inte; hela anteckningen ligger i .sdocx-filen.",
          "returns": "id, titel, mapp, skapad, ändrad, låst, raderad, till papperskorgen, favorit, text, fil, identifierare",
          "sql": "SELECT\n  s._id AS id,\n  CASE WHEN s.title <> '' THEN s.title ELSE substr(CAST(s.content AS TEXT), 1, 80) END AS titel,\n  (SELECT replace(c.displayName, char(8203), '') FROM category_tree c WHERE c.UUID = s.categoryUUID) AS mapp,\n  datetime(s.createdAt / 1000, 'unixepoch') AS skapad_utc,\n  datetime(s.lastModifiedAt / 1000, 'unixepoch') AS andrad_utc,\n  s.isLock AS last,\n  CASE WHEN s.isDeleted = 1 OR s.categoryUUID LIKE 'trash:%' OR s.recycle_bin_time_moved > 0 THEN 1 ELSE 0 END AS raderad,\n  CASE WHEN s.recycle_bin_time_moved > 0 THEN datetime(s.recycle_bin_time_moved / 1000, 'unixepoch') END AS till_papperskorgen_utc,\n  s.isFavorite AS favorit,\n  CASE WHEN s.isLock = 1 THEN NULL ELSE CAST(s.content AS TEXT) END AS text,\n  s.filePath AS fil,\n  s.UUID AS identifierare\nFROM sdoc s\nWHERE s.isLock = 1\nORDER BY s.lastModifiedAt DESC;"
        },
        {
          "id": "notes-folders",
          "title": "Mappar",
          "subtitle": "Mapparna (category_tree) med antalet anteckningar i var och en.",
          "returns": "mapp, sökväg, anteckningar, skapad, raderad",
          "sql": "SELECT replace(c.displayName, char(8203), '') AS mapp, c.UUID AS sokvag, (SELECT COUNT(*) FROM sdoc s WHERE s.categoryUUID = c.UUID) AS anteckningar,\n  datetime(c.createdAt / 1000, 'unixepoch') AS skapad_utc, c.isDeleted AS raderad\nFROM category_tree c\nORDER BY anteckningar DESC, mapp;"
        }
      ]
    }
  ]
};
