/* Genererad från system-logs/catalog.json — används när fetch() blockeras (file://). */
window.SYSTEM_LOGS_CATALOG = {
  "id": "system-logs",
  "title": "Systemloggar som inte är SQL",
  "sourceNote": "Binära loggfiler i en mapp. Filerna tolkas som i Härkomst och raderna läggs i en tabell i minnet; filerna i extraktionen ändras inte. Varje fil står med CRC32 och SHA-256 i raderna om var den kom ifrån.",
  "paramLabels": {},
  "databases": [
    {
      "id": "android-usagestats",
      "os": "Android",
      "label": "usagestats: appar, skärm, lås och notiser",
      "convert": "usagestats",
      "folder": true,
      "blurb": "Androids egen logg över appar i förgrunden, skärmen, låset och notiserna (app och kanal, ingen text). Dagsfilerna under daily/ räcker oftast en vecka bakåt. Rensas för en app när den avinstalleras.",
      "dbPathHint": "/data/system_ce/0/usagestats/ (daily/, mappings, version)",
      "paths": [
        "data/system_ce/0/usagestats/"
      ],
      "source": "Tolkningen i Härkomst (tools/provenance/android-logs.js), protobuf version 4 och 5 (Android 10 och senare)",
      "queries": [
        {
          "id": "usage-notices",
          "title": "Notiser i tidsspann",
          "recommended": true,
          "subtitle": "Visar notiserna: 12 NOTIFICATION_INTERRUPTION när en notis gav ljud, vibration eller en ruta, och 10 NOTIFICATION_SEEN när notiserna visades för användaren, med appen och kanalen. Kanalen säger ofta vilken sorts notis det var (Snapchat: chatt eller snap).",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "lokal tid, typ, app, kanal, UTC, dagsfil",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  typnamn,\n  paket,\n  kanal,\n  tid_utc,\n  fil\nFROM handelser\nWHERE typ IN (10, 12) AND unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        },
        {
          "id": "usage-events",
          "title": "Alla händelser i tidsspann",
          "subtitle": "Visar alla händelser i dagsfilerna med typ, app, aktivitet och kanal.",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "lokal tid, typ, typnamn, app, klass, kanal, UTC, dagsfil",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  typ,\n  typnamn,\n  paket,\n  klass,\n  kanal,\n  tid_utc,\n  fil\nFROM handelser\nWHERE unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        },
        {
          "id": "usage-apps",
          "title": "Appar i förgrunden",
          "subtitle": "Visar när appar kom i förgrunden (1 ACTIVITY_RESUMED) och lämnade den (2 ACTIVITY_PAUSED, 23 ACTIVITY_STOPPED).",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "lokal tid, typnamn, app, aktivitet, UTC",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  typnamn,\n  paket,\n  klass,\n  tid_utc\nFROM handelser\nWHERE typ IN (1, 2, 23) AND unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        },
        {
          "id": "usage-screen",
          "title": "Skärm och lås",
          "subtitle": "Visar när skärmen tändes (15) och släcktes (16), och när låsskärmen visades (17) och låstes upp (18).",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "lokal tid, typnamn, UTC",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  typnamn,\n  tid_utc\nFROM handelser\nWHERE typ BETWEEN 15 AND 18 AND unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        },
        {
          "id": "usage-notice-apps",
          "title": "Notiser per app",
          "group": "advanced",
          "subtitle": "Visar hur många notiser varje app gav i dagsfilerna, och den första och sista.",
          "returns": "app, antal, första (UTC), sista (UTC)",
          "sql": "SELECT\n  paket,\n  COUNT(*) AS notiser,\n  MIN(tid_utc) AS forsta_utc,\n  MAX(tid_utc) AS sista_utc\nFROM handelser\nWHERE typ = 12\nGROUP BY paket\nORDER BY notiser DESC;"
        }
      ]
    },
    {
      "id": "ios-biome-notifications",
      "os": "iOS",
      "label": "Biome Notification.Usage: notiser",
      "convert": "biome-notification-usage",
      "folder": true,
      "blurb": "iOS egen logg över notiser: appen, notisens tid och titeln (för Snapchat avsändarens namn), med en rad per händelse kring notisen. Gamla poster rensas (nollas i filen).",
      "dbPathHint": "/private/var/mobile/Library/Biome/streams/restricted/Notification.Usage/local/",
      "paths": [
        "Library/Biome/streams/restricted/Notification.Usage/local/"
      ],
      "source": "Tolkningen i Härkomst (tools/provenance/biome.js), SEGB version 1 och 2, kontrollerad mot iOS 18.7 och 26.4",
      "queries": [
        {
          "id": "biome-notices",
          "title": "Notiser i tidsspann",
          "recommended": true,
          "subtitle": "Visar en rad per notis med notisens tid, appen, titeln och händelsernas typer i ordning. Typ 17 kommer inom någon sekund efter notisens tid; vad de andra typerna betyder är inte kontrollerat. iOS skriver ofta samma notis under två id med samma tid; Härkomst räknar dem som en.",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "notisens tid (lokal), app, titel, händelser, typer, notisens tid (UTC), notisens id",
          "sql": "SELECT\n  datetime(MIN(notis_unix_ms) / 1000, 'unixepoch', 'localtime') AS notis_lokal,\n  app,\n  titel,\n  COUNT(*) AS handelser,\n  group_concat(typ, ', ') AS typer,\n  MIN(notis_tid_utc) AS notis_utc,\n  notis_id\nFROM (SELECT * FROM notishandelser ORDER BY unix_ms)\nWHERE notis_unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nGROUP BY notis_id\nORDER BY MIN(notis_unix_ms);"
        },
        {
          "id": "biome-notice-events",
          "title": "Alla händelser i tidsspann",
          "subtitle": "Visar varje händelse kring en notis med händelsens tid och typ, notisens tid och var posten ligger i filen.",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "händelsens tid (lokal), typ, app, titel, notisens tid (UTC), händelsens tid (UTC), fil, position, summa",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  typ,\n  app,\n  titel,\n  notis_tid_utc,\n  tid_utc,\n  fil,\n  position,\n  summa_ok\nFROM notishandelser\nWHERE unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}} OR notis_unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        },
        {
          "id": "biome-notice-apps",
          "title": "Notiser per app",
          "group": "advanced",
          "subtitle": "Visar hur många notiser varje app har i strömmen, och den första och sista.",
          "returns": "app, antal, första (UTC), sista (UTC)",
          "sql": "SELECT\n  app,\n  COUNT(DISTINCT notis_id) AS notiser,\n  MIN(notis_tid_utc) AS forsta_utc,\n  MAX(notis_tid_utc) AS sista_utc\nFROM notishandelser\nGROUP BY app\nORDER BY notiser DESC;"
        }
      ]
    },
    {
      "id": "ios-biome-app-infocus",
      "os": "iOS",
      "label": "Biome App.InFocus: appen i förgrunden",
      "convert": "biome-app-infocus",
      "folder": true,
      "blurb": "iOS egen logg över vilken app som var i förgrunden, med skälet till bytet (hemskärmen, en notis, en länk). Samma uppgifter som knowledgeC /app/inFocus, som saknas i nyare iOS.",
      "dbPathHint": "/private/var/mobile/Library/Biome/streams/restricted/App.InFocus/local/",
      "paths": [
        "Library/Biome/streams/restricted/App.InFocus/local/"
      ],
      "source": "Tolkningen i Härkomst (tools/provenance/biome.js), SEGB version 1 och 2, kontrollerad mot iOS 18.7 och 26.4",
      "queries": [
        {
          "id": "biome-focus",
          "title": "Appar i förgrunden i tidsspann",
          "recommended": true,
          "subtitle": "Visar när varje app kom i förgrunden och när den lämnade den, med längden och skälet till bytet.",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "in (lokal), app, ut (lokal), sekunder, skäl, in (UTC)",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS in_lokal,\n  app,\n  datetime(slut / 1000, 'unixepoch', 'localtime') AS ut_lokal,\n  ROUND((slut - unix_ms) / 1000.0, 1) AS sekunder,\n  skal,\n  tid_utc AS in_utc\nFROM (\n  SELECT f.*, (SELECT MIN(u.unix_ms) FROM forgrund u WHERE u.app = f.app AND u.in_i_forgrunden = 0 AND u.unix_ms >= f.unix_ms) AS slut\n  FROM forgrund f\n  WHERE f.in_i_forgrunden = 1\n)\nWHERE unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        },
        {
          "id": "biome-focus-rows",
          "title": "Alla rader i tidsspann",
          "subtitle": "Visar varje rad: 1 när appen kom i förgrunden, 0 när den lämnade den, med skälet, sorten (1 app, 3 kontrollcentret och liknande) och var posten ligger i filen.",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "lokal tid, in, app, skäl, sort, version, UTC, fil, position, summa",
          "sql": "SELECT\n  datetime(unix_ms / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  in_i_forgrunden,\n  app,\n  skal,\n  sort,\n  version,\n  tid_utc,\n  fil,\n  position,\n  summa_ok\nFROM forgrund\nWHERE unix_ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY unix_ms;"
        }
      ]
    }
  ]
};
