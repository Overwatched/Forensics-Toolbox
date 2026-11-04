/* Genererad från app-usage/catalog.json — används när fetch() blockeras (file://). */
window.APP_USAGE_CATALOG = {
  "id": "app-usage",
  "title": "App-aktivitet Queries",
  "sourceNote": "SQL från iLEAPP, ALEAPP och Sarah Edwards (APOLLO/mac4n6). Tiderna visas med datetime(..., 'unixepoch', 'localtime'). Kolumnnamnen är desamma som i databasen. Biome App.InFocus är inte SQLite — använd iLEAPP.",
  "paramLabels": {
    "timeStart": "Från (ÅÅÅÅ-MM-DD TT:MM)",
    "timeEnd": "Till (ÅÅÅÅ-MM-DD TT:MM)",
    "bundleId": "Bundle-ID (valfritt, t.ex. com.apple.camera)",
    "packageName": "Paketnamn (valfritt, t.ex. com.whatsapp)"
  },
  "databases": [
    {
      "id": "knowledgec",
      "label": "iOS — knowledgeC.db",
      "dbPathHint": "/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db (+ -wal, -shm)",
      "paths": [
        "private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db"
      ],
      "source": "https://github.com/abrignoni/iLEAPP/blob/main/scripts/artifacts/knowledgeC.py",
      "sourceExtra": "https://github.com/mac4n6/APOLLO",
      "queries": [
        {
          "id": "app-usage",
          "title": "/app/usage — app aktiv",
          "subtitle": "Visar vilka appar som användes inom tidsspannet, med start, slut och antal sekunder. ZVALUESTRING är appens bundle-ID.",
          "recommended": true,
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd",
            "bundleId"
          ],
          "sql": "SELECT\n  datetime(ZOBJECT.ZSTARTDATE + 978307200, 'unixepoch', 'localtime') AS ZSTARTDATE,\n  datetime(ZOBJECT.ZENDDATE + 978307200, 'unixepoch', 'localtime') AS ZENDDATE,\n  datetime(ZOBJECT.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  ZOBJECT.ZVALUESTRING,\n  (ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE) AS usage_seconds\nFROM ZOBJECT\nWHERE ZOBJECT.ZSTREAMNAME = '/app/usage'\n  AND ZOBJECT.ZSTARTDATE BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\n  AND IFNULL(ZOBJECT.ZVALUESTRING, '') LIKE '%{{bundleId}}%'\nORDER BY ZOBJECT.ZSTARTDATE;"
        },
        {
          "id": "app-infocus",
          "title": "/app/inFocus — förgrund (äldre iOS)",
          "subtitle": "Visar vilken app som låg i förgrunden på skärmen inom tidsspannet. Strömmen saknas på iOS 18 och 26 (de versioner som kontrollerats). Där finns uppgiften i Biome App.InFocus.",
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd",
            "bundleId"
          ],
          "sql": "SELECT\n  datetime(ZOBJECT.ZSTARTDATE + 978307200, 'unixepoch', 'localtime') AS ZSTARTDATE,\n  datetime(ZOBJECT.ZENDDATE + 978307200, 'unixepoch', 'localtime') AS ZENDDATE,\n  datetime(ZOBJECT.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  ZOBJECT.ZSTREAMNAME,\n  ZOBJECT.ZVALUESTRING,\n  (ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE) AS usage_seconds\nFROM ZOBJECT\nWHERE ZOBJECT.ZSTREAMNAME = '/app/inFocus'\n  AND ZOBJECT.ZSTARTDATE BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\n  AND IFNULL(ZOBJECT.ZVALUESTRING, '') LIKE '%{{bundleId}}%'\nORDER BY ZOBJECT.ZSTARTDATE;"
        },
        {
          "id": "is-backlit",
          "title": "/display/isBacklit — skärm tänd",
          "subtitle": "Visar när skärmen tändes och släcktes inom tidsspannet. Jämför med app-aktiviteten för att se om någon tittade på telefonen.",
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "sql": "SELECT\n  datetime(ZOBJECT.ZSTARTDATE + 978307200, 'unixepoch', 'localtime') AS ZSTARTDATE,\n  datetime(ZOBJECT.ZENDDATE + 978307200, 'unixepoch', 'localtime') AS ZENDDATE,\n  datetime(ZOBJECT.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  CASE ZOBJECT.ZVALUEINTEGER\n    WHEN 0 THEN 'Backlight off'\n    WHEN 1 THEN 'Backlight on'\n    ELSE ZOBJECT.ZVALUEINTEGER\n  END AS ZVALUEINTEGER\nFROM ZOBJECT\nWHERE ZOBJECT.ZSTREAMNAME = '/display/isBacklit'\n  AND ZOBJECT.ZSTARTDATE BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY ZOBJECT.ZSTARTDATE;"
        },
        {
          "id": "is-locked",
          "title": "/device/isLocked — låst/olåst",
          "subtitle": "Visar när telefonen låstes och låstes upp inom tidsspannet.",
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "sql": "SELECT\n  datetime(ZOBJECT.ZSTARTDATE + 978307200, 'unixepoch', 'localtime') AS ZSTARTDATE,\n  datetime(ZOBJECT.ZENDDATE + 978307200, 'unixepoch', 'localtime') AS ZENDDATE,\n  datetime(ZOBJECT.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  CASE ZOBJECT.ZVALUEINTEGER\n    WHEN 0 THEN 'Unlocked'\n    WHEN 1 THEN 'Locked'\n    ELSE ZOBJECT.ZVALUEINTEGER\n  END AS ZVALUEINTEGER\nFROM ZOBJECT\nWHERE ZOBJECT.ZSTREAMNAME = '/device/isLocked'\n  AND ZOBJECT.ZSTARTDATE BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY ZOBJECT.ZSTARTDATE;"
        },
        {
          "id": "streams",
          "title": "Hjälp: lista strömmarna i databasen",
          "subtitle": "Söker inte efter händelser. Visar vilka strömmar (ZSTREAMNAME) som finns och hur många rader var och en har, så att du ser vilka queries som kan ge träffar.",
          "group": "advanced",
          "params": [],
          "sql": "SELECT ZSTREAMNAME, COUNT(*) AS n\nFROM ZOBJECT\nGROUP BY ZSTREAMNAME\nORDER BY n DESC;"
        },
        {
          "id": "role-app-usage",
          "hidden": true,
          "role": "app-usage",
          "title": "Härkomst: /app/usage i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa Cocoa-tider för intervall som överlappar tidsfönstret i strömmen /app/usage.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "cocoa",
          "fields": {
            "start": "ZSTARTDATE",
            "end": "ZENDDATE",
            "value": "ZVALUESTRING"
          },
          "sql": "SELECT\n  ZSTARTDATE,\n  ZENDDATE,\n  ZVALUESTRING\nFROM ZOBJECT\nWHERE ZSTREAMNAME = '/app/usage'\n  AND ZENDDATE >= {{cocoaStart}}\n  AND ZSTARTDATE <= {{cocoaEnd}}\nORDER BY ZSTARTDATE;"
        },
        {
          "id": "role-app-infocus",
          "hidden": true,
          "role": "app-infocus",
          "title": "Härkomst: /app/inFocus i tidsfönstret (äldre iOS)",
          "subtitle": "Används av Härkomst. Råa Cocoa-tider för intervall som överlappar tidsfönstret i strömmen /app/inFocus.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "cocoa",
          "fields": {
            "start": "ZSTARTDATE",
            "end": "ZENDDATE",
            "value": "ZVALUESTRING"
          },
          "sql": "SELECT\n  ZSTARTDATE,\n  ZENDDATE,\n  ZVALUESTRING\nFROM ZOBJECT\nWHERE ZSTREAMNAME = '/app/inFocus'\n  AND ZENDDATE >= {{cocoaStart}}\n  AND ZSTARTDATE <= {{cocoaEnd}}\nORDER BY ZSTARTDATE;"
        },
        {
          "id": "role-screen",
          "hidden": true,
          "role": "screen",
          "title": "Härkomst: skärm tänd/släckt i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa Cocoa-tider för intervall som överlappar tidsfönstret i strömmen /display/isBacklit.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "cocoa",
          "fields": {
            "start": "ZSTARTDATE",
            "end": "ZENDDATE",
            "value": "ZVALUEINTEGER"
          },
          "sql": "SELECT\n  ZSTARTDATE,\n  ZENDDATE,\n  ZVALUEINTEGER\nFROM ZOBJECT\nWHERE ZSTREAMNAME = '/display/isBacklit'\n  AND ZENDDATE >= {{cocoaStart}}\n  AND ZSTARTDATE <= {{cocoaEnd}}\nORDER BY ZSTARTDATE;"
        },
        {
          "id": "role-lock",
          "hidden": true,
          "role": "lock",
          "title": "Härkomst: låst/olåst i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa Cocoa-tider för intervall som överlappar tidsfönstret i strömmen /device/isLocked.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "cocoa",
          "fields": {
            "start": "ZSTARTDATE",
            "end": "ZENDDATE",
            "value": "ZVALUEINTEGER"
          },
          "sql": "SELECT\n  ZSTARTDATE,\n  ZENDDATE,\n  ZVALUEINTEGER\nFROM ZOBJECT\nWHERE ZSTREAMNAME = '/device/isLocked'\n  AND ZENDDATE >= {{cocoaStart}}\n  AND ZSTARTDATE <= {{cocoaEnd}}\nORDER BY ZSTARTDATE;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: strömmarnas täckning",
          "subtitle": "Används av Härkomst. Första och sista starttid samt antal rader per ström, så att \"saknas\" kan skiljas från \"utanför täckningen\".",
          "params": [],
          "epoch": "cocoa",
          "fields": {
            "stream": "ZSTREAMNAME",
            "first": "first_start",
            "last": "last_start",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  ZSTREAMNAME,\n  MIN(ZSTARTDATE) AS first_start,\n  MAX(ZSTARTDATE) AS last_start,\n  COUNT(*) AS n_rows\nFROM ZOBJECT\nWHERE ZSTREAMNAME IN ('/app/usage', '/app/inFocus', '/display/isBacklit', '/device/isLocked')\nGROUP BY ZSTREAMNAME;"
        }
      ]
    },
    {
      "id": "interactionc",
      "label": "iOS — interactionC.db",
      "dbPathHint": "/private/var/mobile/Library/CoreDuet/People/interactionC.db (+ -wal, -shm)",
      "paths": [
        "private/var/mobile/Library/CoreDuet/People/interactionC.db"
      ],
      "source": "https://github.com/abrignoni/iLEAPP/blob/main/scripts/artifacts/interactionCcontacts.py",
      "queries": [
        {
          "id": "interactions",
          "title": "Interaktioner per app + person",
          "subtitle": "Visar kontakter med personer inom tidsspannet (meddelanden, samtal, delning) och vilken app som användes. ZBUNDLEID är appen.",
          "recommended": true,
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd",
            "bundleId"
          ],
          "sql": "SELECT\n  datetime(ZINTERACTIONS.ZSTARTDATE + 978307200, 'unixepoch', 'localtime') AS ZSTARTDATE,\n  datetime(ZINTERACTIONS.ZENDDATE + 978307200, 'unixepoch', 'localtime') AS ZENDDATE,\n  ZINTERACTIONS.ZBUNDLEID,\n  ZCONTACTS.ZDISPLAYNAME,\n  ZCONTACTS.ZIDENTIFIER,\n  ZINTERACTIONS.ZDIRECTION,\n  ZINTERACTIONS.ZISRESPONSE,\n  ZINTERACTIONS.ZRECIPIENTCOUNT,\n  datetime(ZINTERACTIONS.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE\nFROM ZINTERACTIONS\nLEFT JOIN ZCONTACTS ON ZINTERACTIONS.ZSENDER = ZCONTACTS.Z_PK\nWHERE ZINTERACTIONS.ZSTARTDATE BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\n  AND IFNULL(ZINTERACTIONS.ZBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY ZINTERACTIONS.ZSTARTDATE;"
        }
      ]
    },
    {
      "id": "wellbeing",
      "label": "Android — Digital Wellbeing (app_usage)",
      "dbPathHint": "/data/data/com.google.android.apps.wellbeing/databases/app_usage",
      "paths": [
        "data/data/com.google.android.apps.wellbeing/databases/app_usage"
      ],
      "source": "https://github.com/abrignoni/ALEAPP/blob/main/scripts/artifacts/wellbeing.py",
      "queries": [
        {
          "id": "resumed",
          "title": "ACTIVITY_RESUMED — app i förgrund",
          "subtitle": "Visar varje gång en app öppnades eller kom tillbaka till förgrunden inom tidsspannet (ACTIVITY_RESUMED).",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd",
            "packageName"
          ],
          "sql": "SELECT\n  datetime(events.timestamp / 1000, 'unixepoch', 'localtime') AS timestamp,\n  packages.package_name,\n  CASE events.type\n    WHEN 1 THEN 'ACTIVITY_RESUMED'\n    WHEN 2 THEN 'ACTIVITY_PAUSED'\n    WHEN 23 THEN 'ACTIVITY_STOPPED'\n    ELSE events.type\n  END AS type\nFROM events\nINNER JOIN packages ON events.package_id = packages._id\nWHERE events.type = 1\n  AND events.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n  AND IFNULL(packages.package_name, '') LIKE '%{{packageName}}%'\nORDER BY events.timestamp;"
        },
        {
          "id": "fg-events",
          "title": "Förgrunds-händelser (resumed/paused/stopped)",
          "subtitle": "Visar när appar öppnades, pausades och stängdes inom tidsspannet, så att du kan se hur länge en app var aktiv.",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd",
            "packageName"
          ],
          "sql": "SELECT\n  datetime(events.timestamp / 1000, 'unixepoch', 'localtime') AS timestamp,\n  packages.package_name,\n  CASE events.type\n    WHEN 1 THEN 'ACTIVITY_RESUMED'\n    WHEN 2 THEN 'ACTIVITY_PAUSED'\n    WHEN 23 THEN 'ACTIVITY_STOPPED'\n    ELSE events.type\n  END AS type\nFROM events\nINNER JOIN packages ON events.package_id = packages._id\nWHERE events.type IN (1, 2, 23)\n  AND events.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n  AND IFNULL(packages.package_name, '') LIKE '%{{packageName}}%'\nORDER BY events.timestamp;"
        },
        {
          "id": "role-app-events",
          "hidden": true,
          "role": "app-events",
          "title": "Härkomst: app-händelser i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa millisekundtider för RESUMED, PAUSED, STOPPED samt skärm- och låshändelser (typ 15–18) om de finns.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "time": "timestamp",
            "type": "type",
            "app": "package_name"
          },
          "sql": "SELECT\n  events.timestamp,\n  events.type,\n  packages.package_name\nFROM events\nINNER JOIN packages ON events.package_id = packages._id\nWHERE events.type IN (1, 2, 23, 15, 16, 17, 18)\n  AND events.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY events.timestamp;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: händelsernas täckning",
          "subtitle": "Används av Härkomst. Första och sista tid samt antal rader, så att \"saknas\" kan skiljas från \"utanför täckningen\".",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first_start",
            "last": "last_start",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  MIN(timestamp) AS first_start,\n  MAX(timestamp) AS last_start,\n  COUNT(*) AS n_rows\nFROM events;"
        }
      ]
    },
    {
      "id": "powerlog",
      "label": "iOS — CurrentPowerlog.PLSQL (PowerLog)",
      "blurb": "Skärmen tänd och släckt, låst och olåst, appen på skärmen och kameran per app, också en apps egen kamera. Tiderna är rättade med PowerLogs tidsförskjutning.",
      "dbPathHint": "/private/var/containers/Shared/SystemGroup/<GUID>/Library/BatteryLife/CurrentPowerlog.PLSQL (+ -wal). Äldre dagar ligger komprimerade i Archives/powerlog_*.PLSQL.gz och läses inte här.",
      "paths": [
        "Library/BatteryLife/CurrentPowerlog.PLSQL"
      ],
      "source": "PowerLog skriver med en egen tid. Den rättade tiden är PowerLogs tid plus tidsförskjutningen som gällde då (PLStorageOperator_EventForward_TimeOffset, kolumnen system, den senaste raden före händelsen). Utan förskjutningsrader blir den rättade tiden tom, och raderna visas inte: PowerLogs egen tid kan räknas från omstarten. Kontrollerat mot en labbtelefon (iOS 26.4.1, 2026-11-03): appen på skärmen och kameran stämmer med knowledgeC på ungefär en sekund. Strax före ett byte av förskjutningen kan tiden avvika med bytets storlek, några sekunder. Kameran: en rad med State 1 och appens bundle-id startar en kamera, en rad med State 0 stänger den. Skärmen: Backlight Active 1 tänd, 0 släckt; SBBlank 1 släckt. Låset: SBLock Locked 1 låst, 0 olåst. Appen på skärmen: AppRole 1 är appen, andra roller ligger ovanpå (Face ID, kontrollcenter, låsskärmen).",
      "queries": [
        {
          "id": "pl-camera",
          "title": "Kameran per app",
          "recommended": true,
          "timeEpoch": "unix",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar när en app startade och stängde kameran, också WhatsApps, Telegrams och Signals egna kameror, med appens bundle-id, kameran och upplösningen.",
          "returns": "tid, händelse, app, kamera, upplösning, bilder/s, PowerLogs tid, UTC",
          "sql": "WITH c AS (\n  SELECT c.timestamp AS raw, c.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= c.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t,\n    c.BundleId, c.CameraType, c.State, c.VideoCaptureWidth, c.VideoCaptureHeight, c.MaximumSupportedFrameRate\n  FROM PLCameraAgent_EventForward_Camera c\n)\nSELECT\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE State WHEN 1 THEN 'kameran startas' WHEN 0 THEN 'kameran stängs' ELSE 'State ' || State END AS handelse,\n  BundleId AS app,\n  CameraType AS kamera,\n  CASE WHEN VideoCaptureWidth > 0 THEN VideoCaptureWidth || '×' || VideoCaptureHeight END AS upplosning,\n  MaximumSupportedFrameRate AS max_bilder_per_s,\n  printf('%.3f', raw) AS powerlog_tid,\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch') AS tid_utc\nFROM c\nWHERE t BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY t;"
        },
        {
          "id": "pl-screen",
          "title": "Skärmen tänd och släckt",
          "timeEpoch": "unix",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar när skärmen tändes och släcktes, ur skärmens bakgrundsljus (Backlight) och SpringBoard (SBBlank).",
          "returns": "tid, händelse, källa, PowerLogs tid, UTC",
          "sql": "WITH s AS (\n  SELECT d.timestamp AS raw, d.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= d.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, d.Active AS tand, 'PLDisplayAgent_EventPoint_Display (Backlight)' AS kalla\n  FROM PLDisplayAgent_EventPoint_Display d WHERE d.Block = 'Backlight'\n  UNION ALL\n  SELECT b.timestamp, b.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= b.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)), 1 - b.Blanked, 'PLSpringBoardAgent_EventForward_SBBlank'\n  FROM PLSpringBoardAgent_EventForward_SBBlank b\n)\nSELECT\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE tand WHEN 1 THEN 'skärmen tänds' WHEN 0 THEN 'skärmen släcks' END AS handelse,\n  kalla,\n  printf('%.3f', raw) AS powerlog_tid,\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch') AS tid_utc\nFROM s\nWHERE t BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY t, kalla;"
        },
        {
          "id": "pl-lock",
          "title": "Låst och olåst",
          "timeEpoch": "unix",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar när telefonen låstes och låstes upp enligt SpringBoard (SBLock).",
          "returns": "tid, händelse, PowerLogs tid, UTC",
          "sql": "WITH l AS (\n  SELECT l.timestamp AS raw, l.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= l.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, l.Locked\n  FROM PLSpringBoardAgent_EventForward_SBLock l\n)\nSELECT\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE Locked WHEN 1 THEN 'låses' WHEN 0 THEN 'låses upp' ELSE 'Locked ' || Locked END AS handelse,\n  printf('%.3f', raw) AS powerlog_tid,\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch') AS tid_utc\nFROM l\nWHERE t BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY t;"
        },
        {
          "id": "pl-apps",
          "title": "App på skärmen",
          "timeEpoch": "unix",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar vilken app som var på skärmen, hemskärmen, låsskärmen och det som låg ovanpå (Face ID, kontrollcenter).",
          "returns": "tid, app, vad, roll, nivå, PowerLogs tid, UTC",
          "sql": "WITH a AS (\n  SELECT a.timestamp AS raw, a.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= a.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, a.bundleID, a.AppRole, a.Level\n  FROM PLScreenStateAgent_EventForward_ScreenState a\n)\nSELECT\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch', 'localtime') AS tid_lokal,\n  bundleID AS app,\n  CASE WHEN AppRole = 1 AND bundleID IN ('com.apple.springboard.home-screen', 'com.apple.springboard.app-switcher') THEN 'hemskärmen eller appväxlaren'\n    WHEN AppRole = 1 THEN 'appen på skärmen'\n    WHEN bundleID = 'com.apple.lock-screen' THEN 'låsskärmen'\n    ELSE 'ovanpå (roll ' || AppRole || ')' END AS vad,\n  AppRole AS roll,\n  Level AS niva,\n  printf('%.3f', raw) AS powerlog_tid,\n  strftime('%Y-%m-%d %H:%M:%f', t, 'unixepoch') AS tid_utc\nFROM a\nWHERE t BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY t;"
        },
        {
          "id": "pl-offsets",
          "title": "PowerLogs tidsförskjutning",
          "group": "advanced",
          "params": [],
          "subtitle": "Raderna som rättar PowerLogs tid. system är förskjutningen i sekunder som läggs till PowerLogs tid.",
          "returns": "tid, system, baseband, kernel, PowerLogs tid, UTC",
          "sql": "SELECT\n  strftime('%Y-%m-%d %H:%M:%f', timestamp + system, 'unixepoch', 'localtime') AS tid_lokal,\n  printf('%.3f', system) AS system_s,\n  printf('%.3f', baseband) AS baseband_s,\n  printf('%.3f', kernel) AS kernel_s,\n  printf('%.3f', timestamp) AS powerlog_tid,\n  strftime('%Y-%m-%d %H:%M:%f', timestamp + system, 'unixepoch') AS tid_utc\nFROM PLStorageOperator_EventForward_TimeOffset\nORDER BY timestamp;"
        },
        {
          "id": "pl-tables",
          "title": "Hjälp: tabeller och antal rader",
          "group": "advanced",
          "params": [],
          "subtitle": "Listar PowerLogs tabeller för kameran, skärmen, SpringBoard och tiden, med antal rader för de som används.",
          "returns": "tabell, rader",
          "sql": "SELECT name AS tabell,\n  CASE name\n    WHEN 'PLCameraAgent_EventForward_Camera' THEN (SELECT count(*) FROM PLCameraAgent_EventForward_Camera)\n    WHEN 'PLDisplayAgent_EventPoint_Display' THEN (SELECT count(*) FROM PLDisplayAgent_EventPoint_Display)\n    WHEN 'PLSpringBoardAgent_EventForward_SBBlank' THEN (SELECT count(*) FROM PLSpringBoardAgent_EventForward_SBBlank)\n    WHEN 'PLSpringBoardAgent_EventForward_SBLock' THEN (SELECT count(*) FROM PLSpringBoardAgent_EventForward_SBLock)\n    WHEN 'PLScreenStateAgent_EventForward_ScreenState' THEN (SELECT count(*) FROM PLScreenStateAgent_EventForward_ScreenState)\n    WHEN 'PLStorageOperator_EventForward_TimeOffset' THEN (SELECT count(*) FROM PLStorageOperator_EventForward_TimeOffset)\n  END AS rader\nFROM sqlite_master\nWHERE type = 'table' AND (name LIKE 'PLCamera%' OR name LIKE 'PLDisplay%' OR name LIKE 'PLSpringBoard%' OR name LIKE 'PLScreenState%' OR name LIKE 'PLStorageOperator%')\nORDER BY rader IS NULL, name;"
        },
        {
          "id": "role-pl-backlight",
          "hidden": true,
          "role": "pl-backlight",
          "title": "Härkomst: skärmens övergångar",
          "subtitle": "Används av Härkomst. Skärmen tänd och släckt (Backlight) med rättad tid, från ett dygn före fönstret.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixS",
          "fields": {
            "time": "t",
            "raw": "raw",
            "active": "active"
          },
          "sql": "SELECT d.timestamp AS raw, d.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= d.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, d.Active AS active\nFROM PLDisplayAgent_EventPoint_Display d\nWHERE d.Block = 'Backlight' AND d.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= d.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) BETWEEN {{unixStart}} - 86400 AND {{unixEnd}}\nORDER BY d.timestamp;"
        },
        {
          "id": "role-pl-lock",
          "hidden": true,
          "role": "pl-lock",
          "title": "Härkomst: låsets övergångar",
          "subtitle": "Används av Härkomst. Låst och olåst (SBLock) med rättad tid, från en vecka före fönstret.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixS",
          "fields": {
            "time": "t",
            "raw": "raw",
            "locked": "locked"
          },
          "sql": "SELECT l.timestamp AS raw, l.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= l.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, l.Locked AS locked\nFROM PLSpringBoardAgent_EventForward_SBLock l\nWHERE l.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= l.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) BETWEEN {{unixStart}} - 604800 AND {{unixEnd}}\nORDER BY l.timestamp;"
        },
        {
          "id": "role-pl-screen",
          "hidden": true,
          "role": "pl-screen",
          "title": "Härkomst: appen på skärmen",
          "subtitle": "Används av Härkomst. ScreenState med rättad tid, från ett dygn före fönstret.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixS",
          "fields": {
            "time": "t",
            "raw": "raw",
            "role": "role",
            "bundle": "bundle"
          },
          "sql": "SELECT a.timestamp AS raw, a.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= a.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, a.AppRole AS role, a.bundleID AS bundle\nFROM PLScreenStateAgent_EventForward_ScreenState a\nWHERE a.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= a.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) BETWEEN {{unixStart}} - 86400 AND {{unixEnd}}\nORDER BY a.timestamp;"
        },
        {
          "id": "role-pl-camera",
          "hidden": true,
          "role": "pl-camera",
          "title": "Härkomst: kameran per app",
          "subtitle": "Används av Härkomst. Kamerans starter och stopp med rättad tid, från en timme före fönstret.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixS",
          "fields": {
            "time": "t",
            "raw": "raw",
            "app": "app",
            "type": "type",
            "state": "state"
          },
          "sql": "SELECT c.timestamp AS raw, c.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= c.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS t, c.BundleId AS app, c.CameraType AS type, c.State AS state\nFROM PLCameraAgent_EventForward_Camera c\nWHERE c.timestamp + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= c.timestamp ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) BETWEEN {{unixStart}} - 3600 AND {{unixEnd}} + 3600\nORDER BY c.timestamp;"
        },
        {
          "id": "role-pl-gaps",
          "hidden": true,
          "role": "pl-gaps",
          "title": "Härkomst: glapp i PowerLog",
          "subtitle": "Används av Härkomst. Glapp på mer än två timmar i PowerLogs täta tabeller: telefonen var avstängd eller PowerLog skrev inte.",
          "params": [],
          "epoch": "unixS",
          "fields": {
            "start": "gap_start",
            "end": "gap_end"
          },
          "sql": "WITH hb AS (\n  SELECT timestamp AS raw FROM PLApplicationAgent_EventForward_Application\n  UNION ALL SELECT timestamp FROM PLPowerAssertionAgent_EventForward_Assertion\n), g AS (\n  SELECT raw, LEAD(raw) OVER (ORDER BY raw) AS nxt FROM hb\n)\nSELECT raw + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= raw ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS gap_start, nxt + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= nxt ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS gap_end\nFROM g\nWHERE nxt - raw > 7200\nORDER BY raw;"
        },
        {
          "id": "role-pl-coverage",
          "hidden": true,
          "role": "pl-coverage",
          "title": "Härkomst: PowerLogs täckning",
          "subtitle": "Används av Härkomst. Första och sista raden i PowerLogs täta tabeller, med rättad tid.",
          "params": [],
          "epoch": "unixS",
          "fields": {
            "first": "first_t",
            "last": "last_t",
            "rows": "n_rows"
          },
          "sql": "WITH hb AS (\n  SELECT timestamp AS raw FROM PLApplicationAgent_EventForward_Application\n  UNION ALL SELECT timestamp FROM PLPowerAssertionAgent_EventForward_Assertion\n), m AS (\n  SELECT MIN(raw) AS a, MAX(raw) AS b, COUNT(*) AS n FROM hb\n)\nSELECT a + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= a ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS first_t, b + COALESCE((SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o WHERE o.timestamp <= b ORDER BY o.timestamp DESC LIMIT 1), (SELECT o.system FROM PLStorageOperator_EventForward_TimeOffset o ORDER BY o.timestamp LIMIT 1)) AS last_t, n AS n_rows\nFROM m;"
        }
      ]
    }
  ]
};
